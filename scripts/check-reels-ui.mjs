// Reels Studio UI sweep (final QA, 2026-11-21). Real headless Chrome over CDP,
// Node's built-in WebSocket, no npm deps. A local static server serves the repo;
// /api/* is stubbed: config, trends and the data sources come from fixtures, and
// the script is the server's own code plan (AI off, no network, no keys).
//
// It walks every state of reel-maker.html at 1440, 1024 and 375, and audits each
// one in light and dark:
//   Story (trends loading / loaded / empty / error, "Start from data" collapsed and
//   expanded, Brief, All settings), the making stepper, Review (every fold, all 4
//   styles, quality checks), Export (organic / paid), Game Swing / Replay / Archive
//   (sources incl. loading / error / empty, story, review with scrubbers and
//   sources, export, carousel), free mode, and the server-offline draft.
// Each state fails on: doubled borders, empty bands, clipped text, horizontal
// page scroll, misaligned sibling cards / buttons, non-ES fonts or purple in the
// chrome, unlabelled controls, more than one primary button, console errors,
// broken images, and low text contrast. Off-grid spacing is reported (warn only).
// Run: node scripts/check-reels-ui.mjs   (skips if Chrome isn't installed)
// Env: REELS_SHOTS=<dir> saves a PNG per state; REELS_ONLY=1440 limits widths.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
if (!CHROME) { console.log('reels ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.REELS_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WIDTHS = (process.env.REELS_ONLY || '1440,1024,375').split(',').map(Number);

// ─── Stubbed API ─────────────────────────────────────────────────────────────
// The server's code plan (no AI, no network): the same draft a free-mode user gets.
const server_ = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;
const fx = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels', name), 'utf8'));
const GAME_DATA = fx('game-data-401873063.response.json');
const GAMES = (() => {
  const base = fx('games-nfl.response.json');
  const d = GAME_DATA.digest;
  const g0 = base.games[0];
  const main = { ...g0, id: d.eventId, name: `${d.teams.away.name} at ${d.teams.home.name}`, teams: { home: { abbr: d.teams.home.abbr, name: d.teams.home.name, score: d.teams.home.score }, away: { abbr: d.teams.away.abbr, name: d.teams.away.name, score: d.teams.away.score } } };
  return { ...base, when: 'recent', games: [main, g0] };
})();
const now = Date.now();
const TRENDS = {
  ok: true, hours: 48, stale: false, updatedAt: new Date(now).toISOString(),
  items: [
    { id: 't1', sport: 'nfl', title: 'Josh Allen throws for 412 yards and 4 TDs as the Bills beat the Chiefs 31-28', source: 'ESPN', url: 'https://example.com/a', publishedAt: new Date(now - 3600e3).toISOString(), team: 'Buffalo Bills', format: 'stat', related: [{ title: 'Allen’s third 400-yard game this season', url: 'https://example.com/b', source: 'NFL' }] },
    { id: 't2', sport: 'cfb', title: 'Ohio State stays No. 1 after a 38-10 win over Michigan State', source: 'CBS Sports', url: 'https://example.com/c', publishedAt: new Date(now - 7200e3).toISOString(), team: 'Ohio State Buckeyes', format: 'explainer', related: [] },
    { id: 't3', sport: 'mlb', title: 'Shohei Ohtani wins his fourth MVP award, the first unanimous pick since 2021', source: 'MLB', url: 'https://example.com/d', publishedAt: new Date(now - 10800e3).toISOString(), team: 'Los Angeles Dodgers', format: 'explainer', related: [] },
    { id: 't4', sport: 'golf', title: 'Scottie Scheffler closes with a 64 to win by three at the Tour Championship', source: 'PGA Tour', url: 'https://example.com/e', publishedAt: new Date(now - 14400e3).toISOString(), team: '', format: 'stat', related: [] },
    { id: 't5', sport: 'nfl', title: 'Cowboys fall 46-40 to the 49ers in a wild shootout at AT&T Stadium', source: 'NFL', url: 'https://example.com/f', publishedAt: new Date(now - 18000e3).toISOString(), team: 'Dallas Cowboys', format: 'explainer', related: [] },
  ],
};
const CLIP = { url: 'https://x.com/NFL/status/1855000000000000001', handle: 'NFL', text: 'What a catch on third down', thumb: '/design-request-hero.webp', postedAt: new Date(now - 3600e3).toISOString(), durationMs: 8000, variants: [{ url: '/design-request-banner.webm', width: 1280, height: 720 }] };
const PHOTOS = ['/how-step-choose.webp', '/how-step-content.webp', '/how-step-export.webp', '/how-step-format.webp', '/how-step-review.webp', '/login-artwork.webp'];

// Scenario switches the sweep flips between page loads.
const scenario = { trends: 'ok', config: 'ok', games: 'ok', library: 'ok', players: 'ok', slow: 0 };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function reelApi(body) {
  const free = scenario.config === 'free';
  const mode = body.mode;
  if (scenario.config === 'offline') return [404, null];
  if (mode === 'config') return [200, { ok: true, ai: !free, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'Voice is not set up here.' }, music: { ready: false }, formats: [], dataFormats: ['gameswing', 'replay', 'archive'], formatModes: { games: true, 'game-data': true, athlete: true, 'archive-research': true, 'frame-pick': true }, aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: false } }];
  if (mode === 'trends') {
    if (scenario.slow) await delay(scenario.slow);
    if (scenario.trends === 'error') return [502, { ok: false, error: 'Trends are unavailable right now.' }];
    if (scenario.trends === 'empty') return [200, { ...TRENDS, items: [] }];
    return [200, TRENDS];
  }
  if (mode === 'plan') {
    const r = await server_.plan(body, { email: 'qa@essentiallysports.com' }, free ? { free: true } : { off: true });
    return [r.ok ? 200 : (r.status || 502), free ? { ...r, mode: 'free', reason: 'user-limit' } : r];
  }
  if (mode === 'games') {
    if (scenario.games === 'error') return [502, { ok: false, error: 'ESPN did not answer.' }];
    if (scenario.games === 'empty' || body.when === 'live') return [200, { ...GAMES, when: body.when, games: [] }];
    return [200, GAMES];
  }
  if (mode === 'game-data') return [200, GAME_DATA];
  if (mode === 'athlete') {
    if (body.athleteId) return [200, fx('athlete-2330.response.json')];
    if (scenario.players === 'empty') return [200, { ok: true, candidates: [] }];
    return [200, fx('athlete-search.response.json')];
  }
  if (mode === 'archive-research') return [200, fx('archive-research-2330.response.json')];
  if (mode === 'frame-pick') return [200, fx('frame-pick.response.json')];
  if (['event', 'project-save', 'projects'].includes(mode)) return [200, { ok: true, cloud: false, projects: [] }];
  // AI modes the page can call (voice, revise, scene, music, clip-judge): AI is off here.
  return [503, { ok: false, reason: 'off', error: 'AI is not available right now.' }];
}
async function videoAdsApi(body) {
  if (body.mode === 'find-clips') return [200, { ok: true, clips: [], cost: 0 }];
  if (body.mode === 'library') {
    if (scenario.library === 'error') return [502, { ok: false, error: 'The clip library is unavailable.' }];
    if (scenario.library === 'empty') return [200, { ok: true, clips: [] }];
    return [200, { ok: true, clips: [CLIP, { ...CLIP, url: CLIP.url.replace(/1$/, '2'), handle: 'Cowboys', text: 'CeeDee Lamb with the toe-tap touchdown in the corner of the end zone, a long caption to test wrapping' }] }];
  }
  if (body.mode === 'clip') {
    if (/bad/.test(body.url)) return [404, { ok: false, error: 'That post has no video.' }];
    return [200, { ok: true, ...CLIP, url: body.url, thumbnail: CLIP.thumb }];
  }
  return [200, { ok: true }];
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, data) => { if (data == null) { res.writeHead(status); res.end(); return; } res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname === '/api/reel-maker') { const [s, d] = await reelApi(await readBody(req)); send(s, d); return; }
  if (url.pathname === '/api/video-ads') { const [s, d] = await videoAdsApi(await readBody(req)); send(s, d); return; }
  if (url.pathname === '/api/es-image-search') { send(200, { source: 'es', results: PHOTOS.map((p, i) => ({ id: `p${i}`, proxyUrl: p, title: `Photo ${i + 1}`, credit: 'ES', width: 1600, height: 900 })) }); return; }
  if (url.pathname === '/api/ai-status') { send(200, scenario.config === 'free' ? { ok: true, mode: 'free', reason: 'user-limit', userLimitUsd: 20 } : { ok: true, mode: 'ai', reason: null }); return; }
  if (url.pathname === '/api/trend-design') { if (scenario.trends === 'error') { send(502, { ok: false }); return; } send(200, { ok: true, items: [] }); return; }
  if (url.pathname.startsWith('/api/')) { send(200, { ok: true }); return; }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

// ─── Chrome ──────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-reels-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pageT = targets.find(t => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
let consoleErrors = [];
const IGNORE_CONSOLE = [/fonts\.(googleapis|gstatic)/, /cdn\.jsdelivr/, /favicon/];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = `${m.params.entry.text} ${m.params.entry.url || ''}`; if (!IGNORE_CONSOLE.some(r => r.test(t)) && !(/Failed to load resource/.test(t) && /\/api\//.test(t))) consoleErrors.push('log: ' + t.slice(0, 200)); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}); // exports are checked, never saved

async function setViewport(w) {
  const h = w < 768 ? 812 : 1000;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
}
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`;
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
await evaluate(SESSION);

async function load(q = '') {
  await evaluate(`(() => { try { localStorage.removeItem('frameup.reels.allFormats.v1'); for (const k of Object.keys(localStorage)) if (/reel/i.test(k)) localStorage.removeItem(k); sessionStorage.clear(); sessionStorage.setItem('frameup.tours.offered', '1'); } catch {} return 1; })()`);
  await send('Page.navigate', { url: `${base}/reel-maker.html${q}` });
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    const ok = await evaluate(`Boolean(window.ReelMakerPage && document.querySelector('#rm-pane-topic')) && document.documentElement.style.visibility !== 'hidden' && !/login/.test(location.pathname)`).catch(() => false);
    if (ok) break;
  }
  if (/login/.test(await evaluate('location.pathname'))) throw new Error('sign-in gate: reel-maker.html went to login');
  await evaluate(`(() => { const s = document.createElement('style'); s.id='qa-calm'; s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 1; })()`);
  await sleep(600);
  consoleErrors = [];
}

// ─── The in-page audit ──────────────────────────────────────────────────────
const AUDIT = fs.readFileSync(path.join(ROOT, 'scripts/lib/reels-ui-audit.js'), 'utf8');

const results = []; // { state, width, theme, issues[], warns[] }
let stateCount = 0;
async function audit(name, w) {
  for (const theme of ['light', 'dark']) {
    await evaluate(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); window.FrameUpTheme?.apply?.(${JSON.stringify(theme)}); return 1; })()`).catch(() => {});
    await sleep(120);
    let r = await evaluate(`(${AUDIT})({ roots: ['#main', '#rm-toasts'], warns: ${theme === 'light'}, ignore: ${JSON.stringify(IGNORE)}, keyActions: ['#rm-next', '#rm-back', '#rm-write', '#rm-export', '#rm-export-carousel', '[data-cuse]'] })`);
    if (r.issues.length) { await sleep(700); r = await evaluate(`(${AUDIT})({ roots: ['#main', '#rm-toasts'], warns: ${theme === 'light'}, ignore: ${JSON.stringify(IGNORE)}, keyActions: ['#rm-next', '#rm-back', '#rm-write', '#rm-export', '#rm-export-carousel', '[data-cuse]'] })`); }
    // Page-specific: the step bar and the tour help stay on one row.
    const head = await evaluate(`(() => { const h = document.querySelector('.rm-head'); if (!h) return ''; const kids = [...h.children].filter(k => k.getBoundingClientRect().height > 1 && getComputedStyle(k).display !== 'none' && getComputedStyle(k).position !== 'absolute'); const rs = kids.map(k => k.getBoundingClientRect()); return rs.some(a => rs.some(b => a.top >= b.bottom - 2)) ? 'the step bar wraps: ' + kids.map(k => k.className || k.tagName).join(' / ') : ''; })()`);
    if (head) r.issues.push(head);
    const errs = consoleErrors.splice(0);
    const issues = [...r.issues, ...errs];
    stateCount++;
    results.push({ state: name, width: w, theme, issues, warns: r.warns });
    if (SHOTS) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTS, `${w}-${theme}-${name.replace(/[^a-z0-9]+/gi, '_')}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await evaluate(`document.documentElement.setAttribute('data-theme', 'light')`);
}
// Selectors the audit leaves alone, with the reason.
const IGNORE = [
  '.rm-canvas',            // the reel itself (a canvas; its pixels are the export)
  '.es-skeleton',          // loading placeholders are empty on purpose
  '.es-sr-only',           // visually hidden text
];

// ─── Page actions ───────────────────────────────────────────────────────────
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const must = async (sel, what) => { if (!(await click(sel))) throw new Error(`${what || sel}: not found`); };
const waitFor = async (expr, ms = 15000, what = expr) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(150); } throw new Error(`timed out waiting for ${what}`); };
const typeInto = (sel, text) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const scrollTop = () => evaluate('(window.scrollTo(0, 0), document.querySelector("#rm-panel")?.scrollTo?.(0, 0), 1)');
const openFold = (sel, open = true) => evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); if (!d) return false; d.open = ${open}; d.scrollIntoView({ block: 'start' }); return true; })()`);
const visible = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);

const behaviour = []; // flow failures (a step that did not do what it says)
async function step(name, fn) {
  try { await fn(); } catch (error) { behaviour.push(`${name}: ${error.message}`); }
}

// ─── The sweep ──────────────────────────────────────────────────────────────
const t0 = Date.now();
for (const w of WIDTHS) {
  await setViewport(w);
  // Story: trends loading, then loaded.
  Object.assign(scenario, { trends: 'ok', config: 'ok', games: 'ok', library: 'ok', players: 'ok', slow: 4000 });
  await load();
  await audit('story-trends-loading', w);
  await waitFor(`document.querySelector('#rm-trends')?.getAttribute('aria-busy') === 'false'`, 8000, 'trends');
  scenario.slow = 0;
  await audit('story-trends', w);
  await step('pick a trend', async () => {
    await must('#rm-trends [data-trend], #rm-trends button', 'trend row');
    await waitFor(`!document.querySelector('#rm-picked').hidden`, 3000, 'picked card');
  });
  await audit('story-trend-picked', w);
  await step('expand Start from data', async () => {
    await must('#rm-fmt-entry [data-gall]', 'All formats toggle');
    await waitFor(`document.querySelector('#rm-fmt-entry').classList.contains('is-open')`, 2000, 'expanded entry');
  });
  await audit('story-data-expanded', w);
  await click('#rm-fmt-entry [data-gall]');
  await step('Brief tab', async () => {
    await must('#rm-source [data-source="brief"]');
    await waitFor(`!document.querySelector('#rm-source-brief').hidden`, 2000, 'brief field');
  });
  await step('empty brief is refused', async () => {
    await typeInto('#rm-brief', '');
    await must('#rm-write');
    await waitFor(`/brief first/i.test(document.querySelector('#rm-write-status').textContent)`, 2000, '"Write a brief first"');
  });
  await audit('story-brief-empty-error', w);
  await typeInto('#rm-brief', 'Josh Allen threw for 412 yards and 4 TDs as the Bills beat the Chiefs 31-28. It is his third 400-yard game this season.');
  await step('All settings', async () => { await openFold('#rm-settings'); });
  await audit('story-all-settings', w);
  await openFold('#rm-settings', false);
  await scrollTop();
  // Make → Review.
  await step('Make my reel', async () => {
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Review step');
  });
  await scrollTop();
  await audit('review', w);
  for (const fold of ['#rm-revise', '#rm-voice', '#rm-style-fold', '#rm-music', '#rm-sources']) {
    if (!(await visible(fold))) continue;
    await openFold(fold);
    await audit(`review-fold-${fold.slice(4)}`, w);
    await openFold(fold, false);
  }
  await step('quality checks', async () => { await must('#rm-statusline'); await waitFor(`!document.querySelector('#rm-lint').hidden`, 2000, 'lint list'); });
  await audit('review-quality-checks', w);
  await click('#rm-statusline');
  await openFold('#rm-style-fold');
  const styles = await evaluate(`[...document.querySelectorAll('#rm-styles-edit [role="radio"]')].map(b => b.dataset.style || b.getAttribute('data-style') || b.textContent.trim())`);
  if (!styles || styles.length !== 4) behaviour.push(`review: expected 4 styles, found ${styles?.length || 0}`);
  for (let i = 0; i < (styles?.length || 0); i++) {
    await step(`style ${styles[i]}`, async () => { await evaluate(`document.querySelectorAll('#rm-styles-edit [role="radio"]')[${i}].click()`); await waitFor(`document.querySelectorAll('#rm-styles-edit [role="radio"]')[${i}].getAttribute('aria-checked') === 'true'`, 3000, 'style picked'); });
    await sleep(300);
    await audit(`review-style-${i + 1}`, w);
  }
  await openFold('#rm-style-fold', false);
  // Export.
  await step('Next: Export', async () => { await must('#rm-next'); await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'Export step'); });
  await scrollTop();
  await audit('export-organic', w);
  if (w === WIDTHS[0]) {
    // One real MP4 export (WebCodecs, or real-time recording as the page falls back).
    await step('Export MP4', async () => {
      await must('#rm-export');
      await waitFor(`!document.querySelector('#rm-files').hidden || /fail|cancel/i.test(document.querySelector('#rm-export-status').textContent)`, 90000, 'exported file row');
      const st = await evaluate(`document.querySelector('#rm-export-status').textContent`);
      if (!/^Exported/.test(st)) throw new Error(`export said: ${st}`);
    });
    await sleep(900);
    await audit('export-done', w);
  }
  await step('Paid ad', async () => { await must('#rm-target [data-target="paid"]'); await waitFor(`document.querySelector('#rm-target [data-target="paid"]').getAttribute('aria-checked') === 'true'`, 2000, 'paid picked'); });
  await audit('export-paid', w);

  // ── Game Swing ──
  await load();
  await step('Game Swing tile', async () => { await must('#rm-fmt-entry [data-gformat="gameswing"]'); await waitFor(`!document.querySelector('#rm-pane-source').hidden && document.querySelector('#rm-games [data-game]')`, 8000, 'game list'); });
  await audit('gs-source-recent', w);
  await step('Live tab (empty)', async () => { await must('[data-gtab="live"]'); await waitFor(`/No live games/.test(document.querySelector('#rm-games')?.textContent || '')`, 4000, 'live empty state'); });
  await audit('gs-source-live-empty', w);
  await step('Search tab', async () => { await must('[data-gtab="search"]'); await waitFor(`!document.querySelector('#rm-g-search').hidden`, 3000, 'search form'); });
  await audit('gs-source-search', w);
  await step('Games error', async () => { scenario.games = 'error'; await must('[data-gsport="cfb"]'); await waitFor(`document.querySelector('#rm-games .es-error-state')`, 4000, 'error state'); });
  await audit('gs-source-error', w);
  scenario.games = 'ok';
  await step('Retry', async () => { await must('#rm-games [data-retry]'); await waitFor(`document.querySelector('#rm-games [data-game]')`, 4000, 'games after retry'); });
  await step('pick a game', async () => {
    await must('[data-gtab="recent"]'); await waitFor(`document.querySelector('#rm-games [data-game="401873063"]')`, 4000, 'the game row');
    await must('#rm-games [data-game="401873063"]');
    await waitFor(`!document.querySelector('#rm-pane-topic').hidden && document.querySelector('#rm-data-story [data-keyplay]')`, 8000, 'key plays');
  });
  await scrollTop();
  await audit('gs-story', w);
  await step('Game Swing make', async () => {
    const ticked = await evaluate(`document.querySelectorAll('#rm-data-story [data-keyplay]:checked').length`);
    if (!ticked) await click('#rm-data-story [data-keyplay]');
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden && !document.querySelector('#rm-data-review').hidden`, 30000, 'Game Swing review');
  });
  await scrollTop();
  await audit('gs-review', w);
  await openFold('#rm-sources'); await audit('gs-review-sources', w); await openFold('#rm-sources', false);
  await step('Game Swing export', async () => { await must('#rm-next'); await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'export'); });
  await scrollTop();
  await audit('gs-export', w);

  // ── Replay ──
  await load();
  await step('Replay tile', async () => { await must('#rm-fmt-entry [data-gformat="replay"]'); await waitFor(`!document.querySelector('#rm-pane-source').hidden && document.querySelector('#rm-c-xform')`, 6000, 'X link form'); });
  await audit('rp-source-x', w);
  await step('bad X link', async () => { await typeInto('#rm-c-link', 'not a link'); await evaluate(`document.querySelector('#rm-c-xform').requestSubmit()`); await waitFor(`document.querySelector('#rm-c-link')?.getAttribute('aria-invalid') === 'true'`, 3000, 'link error'); });
  await audit('rp-source-x-error', w);
  await step('Clip library', async () => { await must('[data-corigin="library"]'); await waitFor(`document.querySelector('#rm-clips [data-clip]')`, 6000, 'library rows'); });
  await audit('rp-source-library', w);
  await step('Library error', async () => { scenario.library = 'error'; await must('[data-csport="mlb"]'); await waitFor(`document.querySelector('#rm-clips .es-error-state')`, 4000, 'library error'); });
  await audit('rp-source-library-error', w);
  scenario.library = 'empty';
  await step('Library empty', async () => { await must('#rm-clips [data-cretry]'); await waitFor(`/No fresh clips/.test(document.querySelector('#rm-clips')?.textContent || '')`, 4000, 'library empty'); });
  await audit('rp-source-library-empty', w);
  scenario.library = 'ok';
  await step('Upload tab', async () => { await must('[data-corigin="upload"]'); await waitFor(`document.querySelector('#rm-c-file')`, 3000, 'upload'); });
  await audit('rp-source-upload', w);
  await step('X link loads the clip', async () => {
    await must('[data-corigin="x"]');
    await typeInto('#rm-c-link', 'https://x.com/NFL/status/1855000000000000001');
    await evaluate(`document.querySelector('#rm-c-xform').requestSubmit()`);
    await waitFor(`document.querySelector('#rm-c-pick [data-cuse]')`, 15000, 'clip card');
  });
  await audit('rp-source-clip', w);
  await step('Use this clip', async () => { await must('#rm-c-pick [data-cuse]'); await waitFor(`!document.querySelector('#rm-pane-topic').hidden && !document.querySelector('#rm-data-story').hidden`, 6000, 'Replay story'); });
  await scrollTop();
  await audit('rp-story', w);
  await step('Replay make', async () => { await must('#rm-write'); await waitFor(`!document.querySelector('#rm-pane-edit').hidden && document.querySelector('#rm-data-review [data-frame]')`, 40000, 'Replay review'); });
  await scrollTop();
  await sleep(600);
  await audit('rp-review', w);
  await step('frame scrubber', async () => { await evaluate(`(() => { const r = document.querySelector('#rm-data-review [data-frame]'); r.value = String((Number(r.min) + Number(r.max)) / 2); r.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`); });
  await openFold('#rm-sources'); await audit('rp-review-sources', w); await openFold('#rm-sources', false);
  await step('Carousel view', async () => { await must('#rm-view [data-view="carousel"]'); await waitFor(`!document.querySelector('#rm-slidenav').hidden`, 4000, 'slide nav'); });
  await audit('rp-review-carousel', w);
  await step('next slide', async () => { await must('#rm-slide-next'); });
  await click('#rm-view [data-view="reel"]');
  await step('Replay export', async () => { await must('#rm-next'); await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'export'); });
  await scrollTop();
  await audit('rp-export', w);
  await step('Replay paid', async () => { await must('#rm-target [data-target="paid"]'); await waitFor(`document.querySelector('#rm-paid-warn')`, 3000, 'league footage warning'); });
  await audit('rp-export-paid', w);

  // ── Archive ──
  await load();
  await step('Archive tile', async () => { await must('#rm-fmt-entry [data-gformat="archive"]'); await waitFor(`!document.querySelector('#rm-pane-source').hidden && document.querySelector('#rm-p-q')`, 6000, 'player search'); });
  await audit('ar-source', w);
  await step('player search', async () => { await typeInto('#rm-p-q', 'Tom Brady'); await waitFor(`document.querySelector('#rm-players [data-athlete]')`, 6000, 'player rows'); });
  await audit('ar-source-results', w);
  await step('player not found', async () => { scenario.players = 'empty'; await typeInto('#rm-p-q', 'Zzzz Nobody'); await waitFor(`/No players found/.test(document.querySelector('#rm-players')?.textContent || '')`, 6000, 'no players'); });
  await openFold('.rm-p-byid');
  await audit('ar-source-empty', w);
  scenario.players = 'ok';
  await step('pick a player', async () => {
    await typeInto('#rm-p-q', 'Tom Brady'); await waitFor(`document.querySelector('#rm-players [data-athlete]')`, 6000, 'player rows');
    await must('#rm-players [data-athlete]');
    await must('[data-angle="Your own"]');
    await waitFor(`!document.querySelector('#rm-angle-own').hidden`, 3000, 'own angle field');
  });
  await audit('ar-source-own-angle', w);
  await step('angle chip', async () => {
    await evaluate(`document.querySelector('[data-angle]').click()`);
    await waitFor(`!document.querySelector('#rm-pane-topic').hidden || document.querySelector('#rm-pane-source').hidden === false`, 3000, 'angle');
    if (await evaluate(`document.querySelector('#rm-pane-topic').hidden`)) await click('#rm-steps [data-step="topic"]');
    await waitFor(`!document.querySelector('#rm-pane-topic').hidden && !document.querySelector('#rm-data-story').hidden`, 6000, 'Archive story');
  });
  await scrollTop();
  await sleep(400);
  await audit('ar-story', w);
  await step('Archive make', async () => { await must('#rm-write'); await waitFor(`!document.querySelector('#rm-pane-edit').hidden && !document.querySelector('#rm-data-review').hidden`, 40000, 'Archive review'); });
  await scrollTop();
  await audit('ar-review', w);
  await step('Carousel view', async () => { await must('#rm-view [data-view="carousel"]'); await waitFor(`!document.querySelector('#rm-slidenav').hidden`, 4000, 'slide nav'); });
  await audit('ar-review-carousel', w);
  await click('#rm-view [data-view="reel"]');
  await step('Archive export', async () => { await must('#rm-next'); await waitFor(`!document.querySelector('#rm-pane-export').hidden && !document.querySelector('#rm-carousel-out').hidden`, 4000, 'export with carousel'); });
  await scrollTop();
  await audit('ar-export', w);
  await step('Export carousel', async () => {
    await must('#rm-export-carousel');
    await waitFor(`/^Exported \\d+ slides/.test(document.querySelector('#rm-carousel-status').textContent) || /fail/i.test(document.querySelector('#rm-carousel-status').textContent)`, 40000, 'carousel zip');
    const st = await evaluate(`document.querySelector('#rm-carousel-status').textContent`);
    if (!/^Exported/.test(st)) throw new Error(`carousel export said: ${st}`);
  });
  await audit('ar-export-carousel-done', w);

  // ── Trends empty / error, free mode, server offline ──
  Object.assign(scenario, { trends: 'empty' }); await load(); await sleep(400); await audit('story-trends-empty', w);
  Object.assign(scenario, { trends: 'error' }); await load(); await sleep(400); await audit('story-trends-error', w);
  Object.assign(scenario, { trends: 'ok', config: 'free' }); await load(); await sleep(600);
  await audit('free-story', w);
  await step('free mode make', async () => {
    await must('#rm-source [data-source="brief"]');
    await typeInto('#rm-brief', 'Shohei Ohtani hit 54 home runs and stole 59 bases this season, the first 50-50 season in MLB history.');
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Review in free mode');
  });
  await scrollTop();
  await audit('free-review', w);
  Object.assign(scenario, { config: 'offline' }); await load(); await sleep(600);
  await audit('offline-story', w);
  await step('offline draft', async () => {
    await must('#rm-source [data-source="brief"]');
    await typeInto('#rm-brief', 'Scottie Scheffler closed with a 64 to win the Tour Championship by three shots.');
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Review offline');
  });
  await scrollTop();
  await audit('offline-review', w);
  Object.assign(scenario, { config: 'ok' });

  if (Date.now() - t0 > 235000 && w !== WIDTHS[WIDTHS.length - 1]) { behaviour.push('time budget hit: some widths not swept'); break; }
}

ws.close(); cleanup();
const bad = results.filter(r => r.issues.length);
const warnTotal = results.reduce((n, r) => n + r.warns.length, 0);
for (const r of bad) console.log(`FAIL ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.issues)].join(' | ')}`);
for (const b of behaviour) console.log(`FAIL behaviour: ${b}`);
if (process.env.REELS_WARN) for (const r of results.filter(x => x.warns.length)) console.log(`warn ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.warns)].join(' | ')}`);
console.log(`reels ui: ${stateCount} states swept (${WIDTHS.join('/')} × light/dark), ${bad.length} with problems, ${behaviour.length} behaviour failures, ${warnTotal} off-grid spacing notes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || behaviour.length ? 1 : 0);
