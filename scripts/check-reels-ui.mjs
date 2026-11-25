// Reels Studio UI sweep (final QA, 2026-11-21). Real headless Chrome over CDP,
// Node's built-in WebSocket, no npm deps. A local static server serves the repo;
// /api/* is stubbed: config, trends and the data sources come from fixtures, and
// the script is the server's own code plan (AI off, no network, no keys).
//
// It walks every state of reel-maker.html at 1440, 1024 and 375, and audits each
// one in light and dark:
//   Story (trends loading / loaded / empty / error, "Start from data" collapsed and
//   expanded, Brief, All settings), the making stepper, Review (every fold, all 5
//   styles, quality checks), Script (ES Reels: your words, block editor, the ES
//   checklist, guidelines dialog, safe-frame overlay, 4:5 export size), Export (organic / paid), Game Swing / Replay / Archive
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
const IGNORE_CONSOLE = [/supabase\.co\/rest\/v1\//, /fonts\.(googleapis|gstatic)/, /cdn\.jsdelivr/, /favicon/];
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
// Tests never write to production Supabase: the usage tracker (frameup-track.js) would send its rows
// with the fake QA session above, and the AI spend meter would read with it: block Supabase data calls (they fail either way).
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });
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
    if (process.env.REELS_DEBUG && r.issues.some(i => /horizontal page scroll/.test(i))) console.log('WIDE', name, theme, await evaluate(`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 2).slice(0, 12).map(e => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().right)).join(' | ')`));
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

const key = async (k, { code = k, vk = 0, shift = false, alt = false } = {}) => { const mod = (alt ? 1 : 0) | (shift ? 8 : 0); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await sleep(60); };
const KEYS = { Tab: 9, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
const press = (k, opts = {}) => key(k, { vk: KEYS[k] || k.toUpperCase().charCodeAt(0), code: KEYS[k] ? k : `Key${k.toUpperCase()}`, ...opts });
const expect = (ok, what) => { if (!ok) throw new Error(what); };
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
  await step('Start tiles and recipes', async () => {
    const tiles = await evaluate(`[...document.querySelectorAll('#rm-fmt-entry [role="radio"]')].map(b => b.dataset.start)`);
    if (tiles.join() !== 'trend,words,game,clip,player,inspo') throw new Error(`tiles: ${tiles}`);
    const recipes = await evaluate(`[...document.querySelectorAll('#rm-recipes [role="radio"]')].map(b => b.dataset.recipe)`);
    if (recipes.length !== 9 || recipes[0] !== '') throw new Error(`recipes: ${recipes}`);
    await must('#rm-recipes [data-recipe="stat-drop"]');
    await waitFor(`document.querySelector('#rm-recipes [data-recipe="stat-drop"]').getAttribute('aria-checked') === 'true' && window.ReelMakerCtx.state.format === 'stat'`, 2000, 'recipe picked');
  });
  await audit('start-recipe-picked', w);
  await click('#rm-recipes [data-recipe=""]');
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
  for (const fold of ['#rm-voice', '#rm-music', '#rm-captions', '#rm-costs', '#rm-more']) {
    await openFold(fold);
    await audit(`start-rail-${fold.slice(4)}`, w);
    await openFold(fold, false);
  }
  await scrollTop();
  // Make → Review.
  await step('Make my reel', async () => {
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Review step');
  });
  await step('focus lands on the first scene after Make my reel', async () => {
    const at = await evaluate(`(() => { const a = document.activeElement; return a && a.matches('#rm-beats [data-sb-face]') ? [...document.querySelectorAll('#rm-beats [data-sb-face]')].indexOf(a) : (a ? a.tagName + '#' + a.id : 'none'); })()`);
    expect(at === 0, `focus is on ${at}`);
  });
  await scrollTop();
  await audit('review', w);
  for (const fold of ['#rm-revise', '#rm-voice', '#rm-music', '#rm-captions', '#rm-sources', '#rm-costs', '#rm-more']) {
    if (!(await visible(fold))) continue;
    await openFold(fold);
    await audit(`review-fold-${fold.slice(4)}`, w);
    await openFold(fold, false);
  }
  await step('quality checks', async () => { await must('#rm-statusline'); await waitFor(`!document.querySelector('#rm-lint').hidden`, 2000, 'lint list'); });
  await audit('review-quality-checks', w);
  await click('#rm-statusline');
  // The rail's Look: the ES looks (lane A's module) when they are loaded, else the page's own style picker.
  await openFold('#rm-style-fold');
  const LOOKS = `(document.querySelector('#rm-looks').hidden ? '#rm-styles' : '#rm-looks')`;
  const styles = await evaluate(`[...document.querySelectorAll(${LOOKS} + ' [role="radio"]')].map(b => b.dataset.look || b.dataset.style || b.textContent.trim())`);
  const hasLooks = await evaluate(`Boolean(window.ReelMakerCtx.modules.looks)`);
  if (hasLooks && (styles.length !== 8 || styles[0] !== 'paper')) behaviour.push(`rail: expected the 8 looks, Paper first; found ${styles}`);
  if (!hasLooks && styles.length < 2) behaviour.push(`rail: expected the style picker, found ${styles?.length || 0}`);
  if (await evaluate(`[...document.querySelectorAll('#rm-looks, #rm-styles, #rm-styles-edit')].filter(e => e.getBoundingClientRect().height > 0).length`) !== 1) behaviour.push('rail: exactly one look picker should show');
  for (let i = 0; i < (styles?.length || 0); i++) {
    if (styles[i] === 'auto') continue;
    await step(`look ${styles[i]}`, async () => { await evaluate(`document.querySelectorAll(${LOOKS} + ' [role="radio"]')[${i}].click()`); await waitFor(`document.querySelectorAll(${LOOKS} + ' [role="radio"]')[${i}].getAttribute('aria-checked') === 'true'`, 3000, 'look picked'); });
    await sleep(300);
    await audit(`review-look-${i + 1}`, w);
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
    await step('Export all (zip)', async () => {
      await must('#rm-export-all');
      await waitFor(`/^Exported \\d+ files in one zip/.test(document.querySelector('#rm-export-status').textContent) || /fail|cancel|did not load/i.test(document.querySelector('#rm-export-status').textContent)`, 150000, 'the zip');
      const r = await evaluate(`({ status: document.querySelector('#rm-export-status').textContent, row: document.querySelector('#rm-files .rm-files__name')?.textContent || '', busy: document.querySelector('#rm-export').disabled })`);
      expect(/^Exported \d+ files in one zip: 1080×1920 (MP4|WEBM)/.test(r.status), `export all said: ${r.status}`);
      expect(/-all\.zip$/.test(r.row), `file row: ${r.row}`);
      expect(/caption file/.test(r.status), `no caption files in the zip: ${r.status}`);
      expect(!r.busy, 'Export MP4 stayed disabled');
    });
    await audit('export-all-done', w);
  }
  await step('Paid ad', async () => { await must('#rm-target [data-target="paid"]'); await waitFor(`document.querySelector('#rm-target [data-target="paid"]').getAttribute('aria-checked') === 'true'`, 2000, 'paid picked'); });
  await audit('export-paid', w);

  // ── Script (ES Reels): the person's words, never rewritten ──
  await load();
  await step('Script tab', async () => {
    await must('#rm-source [data-source="script"]');
    await waitFor(`!document.querySelector('#rm-source-script').hidden`, 2000, 'script field');
  });
  await step('empty script is refused', async () => {
    await must('#rm-write');
    await waitFor(`/script first/i.test(document.querySelector('#rm-write-status').textContent)`, 2000, '"Paste your script first"');
  });
  await audit('story-script-empty-error', w);
  const SCRIPT = 'The Cubs lost on Sunday. But one bar in Chicago got *paid.* Kalshi says 1 in 2,500 bets was insurance. Bettors put $692M on the games, compared to $0.3M as insurance. Fans are still arguing about it.';
  await typeInto('#rm-script', SCRIPT);
  await typeInto('#rm-script-source', 'Source: Kalshi');
  await audit('story-script', w);
  await step('Make from script', async () => {
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Review step');
  });
  await scrollTop();
  await audit('script-review', w);
  await step('script kept word for word', async () => {
    const vo = await evaluate(`window.ReelMakerPage.state.plan.beats.map(b => b.vo).filter(Boolean).join(' ')`);
    if (vo !== SCRIPT) throw new Error(`VO changed: ${vo}`);
    if (!(await evaluate(`document.querySelector('#rm-revise').hidden`))) throw new Error('Revise with AI is offered on a script reel');
    const st = await evaluate(`document.querySelector('#rm-statusline-text').textContent`);
    if (!/Safe frame ✓/.test(st)) throw new Error(`status line: ${st}`);
  });
  await step('ES checklist', async () => { await must('#rm-statusline'); await waitFor(`!document.querySelector('#rm-checklist').hidden && document.querySelectorAll('#rm-checklist li').length === 8`, 2000, 'checklist rows'); });
  await audit('script-checklist', w);
  await click('#rm-statusline');
  await step('block editor', async () => {
    await evaluate(`document.querySelectorAll('#rm-beats [data-sb-face]')[3]?.click()`);
    await waitFor(`document.querySelectorAll('#rm-beats .rm-card')[3]?.classList.contains('is-on') && document.querySelector('#rm-beats .rm-card.is-on [data-field="es.type"]')`, 3000, 'block picker on the picked card');
  });
  await audit('script-block-editor', w);
  await step('storyboard: a card per scene, live thumbnails, the end card last and fixed', async () => {
    const r = await evaluate(`(() => { const c = window.ReelMakerCtx; const cards = [...document.querySelectorAll('#rm-beats .rm-card')]; const px = cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) n += d[i] + d[i + 1] + d[i + 2]; return n; };
      return { cards: cards.length, beats: c.state.plan.beats.length, drawn: cards.every(k => px(k.querySelector('[data-sb-thumb]')) > 0), drop: cards.every(k => k.dataset.riBeat === k.dataset.beat), last: cards.at(-1).classList.contains('is-end'), endMoves: cards.at(-1).querySelectorAll('[data-sb-move], [data-remove]').length, endDrag: cards.at(-1).querySelector('[data-sb-face]').draggable, firstLeft: cards[0].querySelector('[data-sb-move="-1"]').disabled, typed: [...document.querySelectorAll('#rm-beats input, #rm-beats textarea')].filter(e => /\\| ?(blue|red|green)/.test(e.value)).length }; })()`);
    expect(r.cards === r.beats && r.cards >= 4, `cards ${r.cards} / scenes ${r.beats}`);
    expect(r.drawn, 'a thumbnail is blank');
    expect(r.drop, 'a card does not take media drops (data-ri-beat)');
    expect(r.last && r.endMoves === 0 && !r.endDrag, 'the end card can be moved or deleted');
    expect(r.firstLeft, 'scene 1 offers Move left');
    expect(r.typed === 0, 'a field still shows the typed colour syntax');
  });
  await step('colour chips set the colour (no typed syntax)', async () => {
    const r = await evaluate(`(() => { const c = window.ReelMakerCtx; const card = document.querySelector('#rm-beats .rm-card'); const chip = card.querySelector('[data-sb-rows] [data-sb-color="red"]'); chip.click(); const b = c.ES.blockOf(c.state.plan.beats[0]); const input = card.querySelector('[data-sb-text]'); input.value = 'Cubs lost'; input.dispatchEvent(new Event('input', { bubbles: true })); const b2 = c.ES.blockOf(c.state.plan.beats[0]);
      return { color: b.pills[0].color, checked: chip.getAttribute('aria-checked'), id: input.id, text: b2.pills[0].text, kept: b2.pills[0].color, label: chip.getAttribute('aria-label') }; })()`);
    expect(r.color === 'red' && r.checked === 'true' && r.kept === 'red', `chip: ${JSON.stringify(r)}`);
    expect(r.text === 'Cubs lost', `text: ${r.text}`);
    expect(/^rm-es-pills-0-/.test(r.id), `field id ${r.id}`);
    expect(/loss/.test(r.label), `chip label ${r.label}`);
    await evaluate(`(document.querySelector('#rm-beats .rm-card [data-sb-rows] [data-sb-color="ink"]').click(), 1)`);
  });
  await step('rows: add a pill, remove it; the stamp switch', async () => {
    const r = await evaluate(`(async () => { const c = window.ReelMakerCtx; const id = c.state.plan.beats[0].id; const card = () => document.querySelector('#rm-beats [data-beat="' + id + '"]'); const n0 = c.ES.blockOf(c.state.plan.beats[0]).pills.length;
      card().querySelector('[data-sb-add="pills"]').click(); const n1 = c.ES.blockOf(c.state.plan.beats[0]).pills.length; const focusAdd = document.activeElement.matches('[data-sb-text]');
      card().querySelectorAll('[data-sb-del]')[n1 - 1].click(); const n2 = c.ES.blockOf(c.state.plan.beats[0]).pills.length; const focusDel = card().contains(document.activeElement);
      const sw = card().querySelector('[data-sb-stamp]'); sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); const stamp = c.ES.blockOf(c.state.plan.beats[0]).stamp; const field = Boolean(card().querySelector('[data-field="es.stamp.text"]'));
      const sw2 = card().querySelector('[data-sb-stamp]'); sw2.checked = false; sw2.dispatchEvent(new Event('change', { bubbles: true }));
      return { n0, n1, n2, focusAdd, focusDel, stamp, field, off: c.ES.blockOf(c.state.plan.beats[0]).stamp || null }; })()`);
    expect(r.n1 === r.n0 + 1 && r.n2 === r.n0, `rows ${r.n0} -> ${r.n1} -> ${r.n2}`);
    expect(r.focusAdd && r.focusDel, 'focus left the card after add / remove');
    expect(r.stamp && r.stamp.text === 'PAID' && r.field && r.off === null, `stamp ${JSON.stringify(r.stamp)} / off ${JSON.stringify(r.off)}`);
  });
  await step('keyboard: Alt + arrow reorders a scene and says so; the end card stays', async () => {
    await evaluate(`(document.querySelectorAll('#rm-beats [data-sb-face]')[1].focus(), 1)`);
    const before = await evaluate(`window.ReelMakerCtx.state.plan.beats.map(b => b.id)`);
    await press('ArrowRight', { alt: true });
    await sleep(120);
    let r = await evaluate(`({ order: window.ReelMakerCtx.state.plan.beats.map(b => b.id), live: document.querySelector('#rm-sb-live').textContent, focus: document.activeElement.closest('[data-beat]')?.dataset.beat, face: document.activeElement.matches('[data-sb-face]') })`);
    expect(r.order[2] === before[1] && r.order[1] === before[2], `order after Alt+Right: ${r.order}`);
    expect(r.live === `Scene 2 moved to position 3 of ${before.length}`, `announced: “${r.live}”`);
    expect(r.focus === before[1] && r.face, 'focus did not stay on the moved scene');
    await press('ArrowLeft', { alt: true });
    await sleep(120);
    r = await evaluate(`({ order: window.ReelMakerCtx.state.plan.beats.map(b => b.id), live: document.querySelector('#rm-sb-live').textContent })`);
    expect(r.order.join() === before.join(), `order after Alt+Left: ${r.order}`);
    expect(r.live === `Scene 3 moved to position 2 of ${before.length}`, `announced: “${r.live}”`);
    await evaluate(`([...document.querySelectorAll('#rm-beats [data-sb-face]')].at(-1).focus(), 1)`);
    await press('ArrowLeft', { alt: true });
    await sleep(120);
    r = await evaluate(`({ order: window.ReelMakerCtx.state.plan.beats.map(b => b.id), live: document.querySelector('#rm-sb-live').textContent })`);
    expect(r.order.join() === before.join() && /end card stays last/i.test(r.live), `end card: ${r.live}`);
    // Move buttons do the same and keep the keyboard on the card.
    r = await evaluate(`(async () => { const c = window.ReelMakerCtx; const id = c.state.plan.beats[1].id; document.querySelector('#rm-beats [data-beat="' + id + '"] [data-sb-move="1"]').click(); await new Promise(r => setTimeout(r, 80)); const at = c.state.plan.beats.findIndex(b => b.id === id); const focus = document.activeElement.closest('[data-beat]')?.dataset.beat === id; document.querySelector('#rm-beats [data-beat="' + id + '"] [data-sb-move="-1"]').click(); return { at, focus, back: c.state.plan.beats.findIndex(b => b.id === id), words: c.ES.voMatchesScript(c.state.plan) }; })()`);
    expect(r.at === 2 && r.focus && r.back === 1 && r.words, `move buttons: ${JSON.stringify(r)}`);
  });
  await step('keyboard: scrubber keys and its spoken value', async () => {
    await evaluate(`(window.ReelMakerCtx.seek(0), document.querySelector('#rm-scrub').focus(), 1)`);
    const t = () => evaluate(`Math.round(window.ReelMakerCtx.state.t)`);
    const text = () => evaluate(`document.querySelector('#rm-scrub').getAttribute('aria-valuetext')`);
    expect(/^0:00, scene 1 of \d+, Hook$/.test(await text()), `valuetext at 0: ${await text()}`);
    await press('ArrowRight'); expect(await t() === 33, `one frame: ${await t()}`);
    await press('ArrowRight', { shift: true }); expect(await t() === 1033, `one second: ${await t()}`);
    await press('ArrowLeft'); expect(await t() === 1000, `back a frame: ${await t()}`);
    await press('l'); expect(await t() === 3000, `L skips two seconds: ${await t()}`);
    await press('j'); expect(await t() === 1000, `J skips back: ${await t()}`);
    await press('End'); const end = await evaluate(`window.ReelMakerCtx.state.timeline.durationMs - 1`); expect(await t() === end, `End: ${await t()}`);
    expect(/, scene (\d+) of \1, End card$/.test(await text()), `valuetext at the end: ${await text()}`);
    await press('Home'); expect(await t() === 0, `Home: ${await t()}`);
    await press('k'); await sleep(250); expect(await evaluate(`window.ReelMakerCtx.state.playing`), 'K did not play');
    await press('k'); await sleep(120); expect(!(await evaluate(`window.ReelMakerCtx.state.playing`)), 'K did not pause');
    expect(await evaluate(`document.activeElement.id`) === 'rm-scrub', 'focus left the scrubber');
  });
  await step('the scene on screen is described in words, on a scene change only', async () => {
    const r = await evaluate(`(async () => { const c = window.ReelMakerCtx; const el = document.querySelector('#rm-scene-desc'); const b = c.state.timeline.beats; c.seek(b[2].inMs + 900); const a = el.textContent; let writes = 0; const mo = new MutationObserver(() => { writes += 1; }); mo.observe(el, { childList: true, characterData: true, subtree: true }); c.seek(b[2].inMs + 1200); c.seek(b[2].inMs + 1500); await new Promise(r => setTimeout(r, 50)); const same = writes; c.seek(b[3].inMs + 900); await new Promise(r => setTimeout(r, 50)); mo.disconnect(); return { a, same, next: el.textContent, live: el.getAttribute('aria-live') }; })()`);
    expect(/^Scene 3 of \d+: \w/.test(r.a) && /Voiceover: /.test(r.a), `description: ${r.a}`);
    expect(r.same === 0, `described ${r.same} times inside one scene`);
    expect(/^Scene 4 of /.test(r.next) && r.live === 'polite', `next: ${r.next}`);
  });
  await step('focus returns: the guidelines dialog, a deleted scene, a step change', async () => {
    let r = await evaluate(`(async () => { const link = document.querySelector('#rm-pane-edit [data-open-guide]'); document.querySelector('#rm-lint').hidden = false; link.focus(); link.click(); await new Promise(r => setTimeout(r, 80)); const inDialog = document.querySelector('#rm-guide').contains(document.activeElement); document.querySelector('#rm-guide').close(); await new Promise(r => setTimeout(r, 80)); document.querySelector('#rm-lint').hidden = true; return { inDialog, back: document.activeElement === link }; })()`);
    expect(r.inDialog && r.back, `guidelines dialog: ${JSON.stringify(r)}`);
    r = await evaluate(`(async () => { const c = window.ReelMakerCtx; const n = c.state.plan.beats.length; const id = c.state.plan.beats[2].id; document.querySelector('#rm-beats [data-beat="' + id + '"] [data-remove]').click(); await new Promise(r => setTimeout(r, 80)); const a = document.activeElement; const onFace = a.matches('#rm-beats [data-sb-face]') && a.closest('[data-beat]').dataset.beat === c.state.selected; document.querySelector('#rm-toasts .es-toast-action').click(); await new Promise(r => setTimeout(r, 80)); return { onFace, n, after: c.state.plan.beats.length, words: c.ES.voMatchesScript(c.state.plan) }; })()`);
    expect(r.onFace && r.after === r.n && r.words, `delete + undo: ${JSON.stringify(r)}`);
    await must('#rm-steps [data-step="topic"]'); await sleep(80);
    expect(await evaluate(`document.activeElement.matches('#rm-fmt-entry [role="radio"][aria-checked="true"]')`), 'Start: focus is not on the picked tile');
    await must('#rm-steps [data-step="edit"]'); await sleep(80);
    expect(await evaluate(`document.activeElement.matches('#rm-beats .rm-card.is-on [data-sb-face]')`), 'Storyboard: focus is not on the picked scene');
  });
  await step('Size 4:5: the preview, the thumbnails and the export follow', async () => {
    await must('#rm-aspect [data-aspect="4:5"]'); await sleep(250);
    const r = await evaluate(`({ h: document.querySelector('#rm-canvas').height, size: window.ReelMakerCtx.state.timeline.size.join('x'), thumb: document.querySelector('#rm-beats [data-sb-thumb]').height, cls: document.querySelector('#rm-device').classList.contains('is-45'), meta: document.querySelector('#rm-stage-meta').textContent })`);
    expect(r.h === 1350 && r.size === '1080x1350' && r.thumb === 135 && r.cls && /1080×1350/.test(r.meta), `4:5: ${JSON.stringify(r)}`);
  });
  await audit('script-size-45', w);
  await click('#rm-aspect [data-aspect="9:16"]'); await sleep(200);
  await step('versions: three ways, a switcher above the storyboard (looks from lane A; a stand-in here when they are not loaded)', async () => {
    const r = await evaluate(`(async () => { const c = window.ReelMakerCtx; let look = 'paper';
      if (!c.modules.looks) c.register('looks', { list: () => [{ id: 'paper', label: 'Paper', blurb: 'Paper' }, { id: 'ink', label: 'Ink', blurb: 'Ink' }, { id: 'bold', label: 'Bold', blurb: 'Bold' }], current: () => (c.state.plan && c.state.plan.look) || look, set: id => { look = id; if (c.state.plan) c.state.plan.look = id; c.emit('look', { look: id }); return true; }, thumb: () => {} });
      c.renderEdit(); await new Promise(r => setTimeout(r, 60));
      const pickers = [...document.querySelectorAll('#rm-looks, #rm-styles, #rm-styles-edit')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.id);
      const btn = document.querySelector('#rm-versions-make'); const label = btn.textContent.trim(); const note = document.querySelector('#rm-versions-note').textContent; btn.focus(); btn.click(); await new Promise(r => setTimeout(r, 300));
      const radios = [...document.querySelectorAll('#rm-version-pick [role="radio"]')]; const labels = radios.map(b => b.textContent); const base = c.state.plan; const words = c.state.plan.beats.map(b => b.vo).join(' ');
      radios[1].click(); await new Promise(r => setTimeout(r, 200));
      const v2 = { look: c.state.plan.look, same: c.state.plan.beats.map(b => b.vo).join(' ') === words, ids: c.state.plan.beats.map(b => b.id).join() === base.beats.map(b => b.id).join(), other: c.state.plan !== base, checked: document.querySelectorAll('#rm-version-pick [role="radio"]')[1].getAttribute('aria-checked'), focus: document.activeElement.dataset.version };
      document.querySelectorAll('#rm-version-pick [role="radio"]')[0].click(); await new Promise(r => setTimeout(r, 200));
      return { pickers, label, note, labels, v2, back: c.state.plan === base, n: c.state.versions.length }; })()`);
    expect(r.pickers.join() === 'rm-looks', `look pickers showing: ${r.pickers}`);
    expect(r.label === 'Make 3 versions' && /Free/.test(r.note), `button: ${r.label} / ${r.note}`);
    expect(r.n === 3 && r.labels[0] === 'As made' && r.labels.slice(1).every(l => / look$/.test(l)), `versions: ${r.labels}`);
    expect(r.v2.look && r.v2.look !== 'paper' && r.v2.same && r.v2.ids && r.v2.other && r.v2.checked === 'true' && r.v2.focus === '1', `version 2: ${JSON.stringify(r.v2)}`);
    expect(r.back, 'version 1 is not the reel as made');
  });
  await scrollTop();
  await audit('script-versions', w);
  await step('guidelines dialog', async () => { await must('#rm-lint [data-open-guide], [data-open-guide]'); await waitFor(`document.querySelector('#rm-guide').open && document.querySelectorAll('#rm-guide-body section').length >= 5`, 2000, 'guidelines'); });
  await audit('script-guidelines', w);
  await evaluate(`document.querySelector('#rm-guide').close()`);
  await step('safe frame overlay', async () => { await must('#rm-safe-toggle'); await waitFor(`!document.querySelector('#rm-safe').hidden && document.querySelector('#rm-safe').classList.contains('rm-safe--es')`, 2000, 'ES safe frame'); });
  await audit('script-safe-frame', w);
  await click('#rm-safe-toggle');
  await step('Export size 4:5', async () => {
    await must('#rm-next'); await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'Export step');
    await must('#rm-aspect [data-aspect="4:5"]'); await waitFor(`document.querySelector('#rm-aspect [data-aspect="4:5"]').getAttribute('aria-checked') === 'true'`, 2000, '4:5 picked');
  });
  await scrollTop();
  await audit('script-export-45', w);

  // ── Reduced motion: a calm preview by default, exports untouched ──
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load();
  await step('reduced motion: the preview cuts between scenes and says the export does not', async () => {
    await must('#rm-source [data-source="script"]');
    await typeInto('#rm-script', SCRIPT);
    await must('#rm-write');
    await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 30000, 'Storyboard step');
    const r = await evaluate(`(() => { const c = window.ReelMakerCtx; const cv = document.querySelector('#rm-canvas'); const sum = () => { const d = cv.getContext('2d').getImageData(0, 0, 1080, 1920).data; let n = 0; for (let i = 0; i < d.length; i += 64) n = (n + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) % 1000003; return n; };
      const b = c.state.timeline.beats[2]; const at = t => { c.seek(t); return sum(); };
      const on = c.state.calm; const pressed = document.querySelector('#rm-calm').getAttribute('aria-pressed'); const note = document.querySelector('#rm-calm-note'); const noteShown = !note.hidden && /export keeps the full motion/i.test(note.textContent);
      const calmMid = at(b.inMs + 100); const calmHeld = at(b.inMs - 1);
      document.querySelector('#rm-calm').click(); const fullMid = at(b.inMs + 100); const off = !c.state.calm && note.hidden;
      document.querySelector('#rm-calm').click();
      return { on, pressed, noteShown, cut: calmMid === calmHeld, wipe: fullMid !== calmMid, off, exportSame: String(c.exportReel).includes('calm') === false }; })()`);
    expect(r.on && r.pressed === 'true' && r.noteShown, `calm preview is not on by default: ${JSON.stringify(r)}`);
    expect(r.cut, 'mid-wipe is not a cut (the old scene is not held)');
    expect(r.wipe && r.off, 'the full-motion preview did not come back');
    expect(r.exportSame, 'the export reads the calm setting');
  });
  await audit('reduced-motion-storyboard', w);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ── Focus order on Start; Inspiration and Brainstorm with and without lane B ──
  await load();
  await waitFor(`document.querySelector('#rm-trends')?.getAttribute('aria-busy') === 'false'`, 8000, 'trends');
  await step('focus order: steps, Start tiles (one stop), the source, recipes (one stop), Make my reel, then Settings', async () => {
    const order = await evaluate(`(() => { const main = document.querySelector('#main'); const tab = [...main.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')].filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden], [inert]') && !(e.closest('details:not([open])') && !e.matches('summary')));
      const zone = e => e.closest('#rm-steps') ? 'steps' : e.closest('#rm-fmt-entry') ? 'tiles' : e.closest('#rm-topic') ? 'source' : e.closest('#rm-recipes') ? 'recipes' : e.id === 'rm-write' ? 'make' : e.closest('#rm-settings') ? 'rail' : e.closest('#rm-stage') ? 'stage' : 'other';
      const zones = []; tab.forEach(e => { const z = zone(e); if (zones[zones.length - 1] !== z) zones.push(z); });
      return { zones, tiles: tab.filter(e => e.closest('#rm-fmt-entry')).length, recipes: tab.filter(e => e.closest('#rm-recipes')).length, positive: tab.filter(e => e.tabIndex > 0).length }; })()`);
    const want = ['steps', 'tiles', 'source', 'recipes', 'make'];
    const got = order.zones.filter(z => want.includes(z));
    expect(got.join() === want.join(), `tab order: ${order.zones}`);
    expect(order.zones.indexOf('rail') > order.zones.indexOf('make') || w >= 901, `Settings before Make my reel on a phone: ${order.zones}`);
    expect(order.tiles === 1 && order.recipes === 1 && order.positive === 0, `roving stops: ${JSON.stringify(order)}`);
    // Real keys: Tab from the picked tile leaves the tiles; arrows move inside them.
    await evaluate(`(document.querySelector('#rm-fmt-entry [aria-checked="true"]').focus(), 1)`);
    await press('ArrowRight'); await sleep(80);
    expect(await evaluate(`document.activeElement.dataset.start === 'words' && window.ReelMakerCtx.state.start === 'words' && !document.querySelector('#rm-source-words').hidden`), 'Arrow right did not move to Script or brief');
    await press('Tab');
    expect(await evaluate(`!document.activeElement.closest('#rm-fmt-entry') && Boolean(document.activeElement.closest('#rm-topic'))`), 'Tab from a tile did not go to its source');
    const ring = await evaluate(`(() => { document.querySelector('#rm-fmt-entry [aria-checked="true"]').focus(); return 1; })()`); void ring;
    await press('ArrowLeft'); await sleep(80);
  });
  await step('Inspiration: off until lane B is loaded, then its panels sit on the Start screen', async () => {
    const hasB = await evaluate(`Boolean(window.ReelMakerCtx.modules.radar || window.ReelMakerCtx.modules.ideas)`);
    if (!hasB) {
      const off = await evaluate(`(() => { const t = document.querySelector('#rm-fmt-entry [data-start="inspo"]'); t.click(); return { disabled: t.getAttribute('aria-disabled'), start: window.ReelMakerCtx.state.start, brainstorm: document.querySelector('#rm-brainstorm-row').hidden, toast: document.querySelector('#rm-toasts').textContent }; })()`);
      expect(off.disabled === 'true' && off.start !== 'inspo' && off.brainstorm && /coming soon/i.test(off.toast), `without lane B: ${JSON.stringify(off)}`);
      await evaluate(`(() => { const c = window.ReelMakerCtx; window.__b = { radar: 0, ideas: 0, opened: null }; const panel = (name, title) => ({ mount(el) { window.__b[name] += 1; el.innerHTML = '<div class="rm-sec"><h3 class="rm-sec__title">' + title + '</h3><p class="rm-hint">Stand-in panel for the check.</p></div>'; return this; }, open(o) { window.__b.opened = { name, ...o }; return this; }, close() {} }); c.register('radar', panel('radar', 'What is doing well')); c.register('ideas', panel('ideas', 'Ideas room')); document.querySelectorAll('#rm-toasts .rm-toast').forEach(t => t.remove()); return 1; })()`);
    }
    await sleep(80);
    await must('#rm-trends [data-trend]');
    const r = await evaluate(`(async () => { const c = window.ReelMakerCtx; const t = document.querySelector('#rm-fmt-entry [data-start="inspo"]'); const row = document.querySelector('#rm-brainstorm-row'); const enabled = t.getAttribute('aria-disabled') !== 'true' && !row.hidden;
      document.querySelector('#rm-brainstorm').click(); await new Promise(r => setTimeout(r, 120));
      return { enabled, start: c.state.start, shown: !document.querySelector('#rm-source-inspo').hidden && document.querySelector('#rm-radar-host').childElementCount > 0 && document.querySelector('#rm-ideas-host').childElementCount > 0, make: document.querySelector('#rm-write').hidden, recipes: document.querySelector('#rm-recipe-sec').hidden, temp: Boolean(document.querySelector('#rb-entry')), stub: window.__b || null }; })()`);
    expect(r.enabled && r.start === 'inspo' && r.shown, `Inspiration: ${JSON.stringify(r)}`);
    expect(r.make && r.recipes, 'Make my reel or the recipes still show on Inspiration');
    expect(!r.temp, 'lane B’s temporary buttons are still on the page');
    if (r.stub) expect(r.stub.radar === 1 && r.stub.ideas === 1 && r.stub.opened && r.stub.opened.name === 'ideas' && r.stub.opened.trend && r.stub.opened.topic, `stand-in calls: ${JSON.stringify(r.stub)}`);
  });
  await audit('start-inspiration', w);
  await step('back to Trend', async () => { await must('#rm-fmt-entry [data-start="trend"]'); await waitFor(`!document.querySelector('#rm-write').hidden && !document.querySelector('#rm-source-trend').hidden`, 2000, 'trend list'); });

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

  if (Date.now() - t0 > 900000 && w !== WIDTHS[WIDTHS.length - 1]) { behaviour.push('time budget hit: some widths not swept'); break; }
}

ws.close(); cleanup();
const bad = results.filter(r => r.issues.length);
const warnTotal = results.reduce((n, r) => n + r.warns.length, 0);
for (const r of bad) console.log(`FAIL ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.issues)].join(' | ')}`);
for (const b of behaviour) console.log(`FAIL behaviour: ${b}`);
if (process.env.REELS_WARN) for (const r of results.filter(x => x.warns.length)) console.log(`warn ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.warns)].join(' | ')}`);
console.log(`reels ui: ${stateCount} states swept (${WIDTHS.join('/')} × light/dark), ${bad.length} with problems, ${behaviour.length} behaviour failures, ${warnTotal} off-grid spacing notes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || behaviour.length ? 1 : 0);
