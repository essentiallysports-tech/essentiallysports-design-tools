// Video Ads UI check: drives video-ads.html in real headless Chrome through
// every step and state (Copy: styles, brands, zones, Ask AI options / grammar /
// chat / errors, daily set; Clip: every tab with results, empty, error and
// multi-pick; the stage: sizes, Meta preview, safe zone, Frame + Tint rail,
// with and without a clip; Export: sound modes, 3-style grid, set mode,
// preflight, progress and done; free mode; Competitor ads: sample data, not set
// up, loading, results, every section, empty, error, over the cap, Use this
// idea), at 1440, 1024 and 375, in light
// and dark, and fails on:
//    1 doubled borders (a control's box inside an equally sized bordered box)
//    2 empty bands (a visible section or card with nothing visible in it)
//    3 clipped text (cut by an overflow box without an intended ellipsis)
//    4 horizontal page scroll
//    5 misaligned siblings (cards / buttons in one row with different heights,
//      card action rows at different y)
//    6 off-grid spacing (gaps and paddings not a multiple of 4): reported only
//    7 non-ES fonts and purple in the UI chrome
//    8 unlabelled controls, and more than one primary button in view
//    9 console errors and uncaught exceptions
//   10 broken images
//   11 contrast below 4.5:1 (small text) or 3:1 (large text)
// It also checks behaviour: each step's main buttons do what they say.
// All /api/* calls are stubbed (no AI, no Supabase); clips come from a local file.
// Run: node scripts/check-video-ads-ui.mjs   (skips if Chrome isn't installed)
//      VA_ONLY=1440-light  limits the sweep;  VA_SHOTS=dir  saves screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
if (!CHROME) { console.log('video ads ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('video ads ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const T0 = Date.now();
const SHOTS = process.env.VA_SHOTS ? path.resolve(process.env.VA_SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ─── Stub API: one scenario at a time (ok | empty | error | free) ──────────
const api = { scenario: 'ok', delay: 0 };
const CLIP_FILE = path.join(ROOT, 'design-request-banner.webm');
const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
const clip = (i, sport, extra = {}) => ({
  url: `https://x.com/team${i}/status/${1000 + i}`,
  handle: ['NFL', 'ESPNCFB', 'MLB', 'Buckeyes', 'Yankees', 'Chiefs'][i % 6],
  // Trusted sources only (2026-11-19): X accounts, ESPN and MLB.com, each with its label.
  platform: ['x', 'espn', 'x', 'mlb'][i % 4],
  trust: { kind: ['official', 'media', 'league', 'league'][i % 4], label: [`@${['NFL', 'ESPNCFB', 'MLB', 'Buckeyes', 'Yankees', 'Chiefs'][i % 6]} · team account`, 'ESPN · network', '@MLBNetwork · league account', 'MLB.com · league site'][i % 4] },
  text: ['Unreal one-handed grab in the end zone to win it late in the fourth quarter', 'Walk-off homer!', 'What a run', 'Pick six to seal the game and the season, with a very long caption that keeps going on and on'][i % 4],
  thumb: `https://fixtures.test/thumb-${i % 3}.webp`,
  duration: 12 + i, quality: i % 2 ? '720p' : '1080p', sourceKind: ['official', 'league', 'media', ''][i % 4],
  postedAt: hoursAgo(2 + i * 5), views: 10000 * (10 - i), likes: 500 * (10 - i), hasAudio: i % 3 !== 0,
  teams: i % 2 ? ['Ohio State Buckeyes'] : ['Michigan Wolverines'], sport,
  variants: [{ url: `https://fixtures.test/clip-${i}.webm`, width: 1280, height: 720, bitrate: 2e6 }],
  ...extra,
});
const clips = (sport, n = 12) => Array.from({ length: n }, (_, i) => clip(i, sport));
const variants = [
  { style: 'highlight', headline: 'Every Buckeyes story, before kickoff. Free.', highlight: 'Free.', body: ['The plays, the depth chart, the rumours that matter. One email, every morning.'], cta: 'Sign up free', why: 'Leads with the team' },
  { style: 'condensed', headline: 'Your Saturday starts in your inbox', highlight: '', body: ['College football news that respects your time. Free, every day.'], cta: 'Get it free', why: 'Calm and clear' },
  { style: 'simple', headline: 'College football, without the noise', highlight: '', body: ['One short email a day. Free.'], cta: 'Join free', why: 'Short' },
];
function apiReply(body, url) {
  if (url === '/api/ai-status') return api.scenario === 'free' ? { ok: true, mode: 'free', reason: 'user-limit', userLimitUsd: 20 } : { ok: true, mode: 'ai' };
  if (url === '/api/meta-ads') return metaReply(body);
  if (url !== '/api/video-ads') return { ok: true };
  const m = body?.mode;
  if (api.scenario === 'error') return [500, { ok: false, error: 'Video Ads is unavailable right now.' }];
  if (api.scenario === 'free' && ['copy', 'chat', 'grammar', 'suggest-style'].includes(m)) return { ok: true, mode: 'free', skipped: true, reason: 'user-limit', notice: "You've used this week's AI budget, so FrameUp is in free mode." };
  const empty = api.scenario === 'empty';
  const sport = body?.sport && body.sport !== 'all' ? body.sport : 'cfb';
  switch (m) {
    case 'trends': return { ok: true, items: empty ? [] : [{ id: 't1', title: 'Ohio State edges Michigan in a classic', sport: 'cfb', related: [] }, { id: 't2', title: 'Chiefs clinch the division', sport: 'nfl', related: [] }, { id: 't3', title: 'Yankees walk it off in the ninth', sport: 'mlb', related: [] }] };
    case 'find-clips': return { ok: true, clips: empty ? [] : clips(sport, 12), teams: [] };
    case 'library': return { ok: true, clips: empty ? [] : clips(sport, 14), total: empty ? 0 : 14, teams: [] };
    case 'moments-with-clips': return { ok: true, ranking: 'trending', moments: empty ? [] : Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, title: ['Buckeyes stun Michigan on a late drive', 'Walk-off in the Bronx', 'Mahomes to Kelce for the win', 'A pick six that ended the season for the rival with a long title'][i % 4], sport: ['cfb', 'mlb', 'nfl', 'cfb'][i % 4], teams: ['Ohio State Buckeyes'], clips: [clip(i, 'cfb'), clip(i + 20, 'cfb')] })) };
    case 'clip': return { ok: true, platform: 'x', handle: 'NFL', title: 'A post', quality: '720p', variants: [{ url: 'https://fixtures.test/clip-link.webm', width: 1280, height: 720 }] };
    case 'copy': return body?.set ? { ok: true, variants: [...variants, { ...variants[0], style: 'today3', listTitle: 'Today in CFB', items: ['Buckeyes hold on', 'Playoff picture shifts', 'Heisman race tightens'], offer: 'Free, every morning' }] } : { ok: true, variants };
    case 'grammar': return { ok: true, issues: [{ field: 'headline', original: 'from your dad', suggestion: 'from your father', reason: 'Plainer word' }, { field: 'body', index: 0, original: 'Nobody picks', suggestion: 'No one picks', reason: 'Style' }] };
    case 'chat': return { ok: true, reply: 'I made the headline shorter and kept that it’s free.', patch: { headline: 'The team you were handed. Keep up with it, free.' } };
    case 'suggest-style': return { ok: true, ranking: [{ style: 'highlight', score: 8.6 }] };
    case 'claims': return { ok: true, canEdit: false, claims: {} };
    default: return { ok: true };
  }
}
// Competitor ads (/api/meta-ads): the sample data reshaped as live replies.
const DEMO = (() => { const box = {}; new Function('self', fs.readFileSync(path.join(ROOT, 'video-ads-competitors-demo.js'), 'utf8'))(box); return box.VideoAdsCompetitorsDemo; })();
function metaReply(body) {
  const m = body?.mode;
  if (m === 'status') return { ok: true, configured: api.scenario !== 'comp-off', capUsd: 4, estimateUsd: 0.015, perResultUsd: 0.0003 };
  if (api.scenario === 'comp-off') return [503, { ok: false, reason: 'not-set-up', error: "Competitor ads isn't set up yet. Ask an admin to add APIFY_TOKEN in Vercel to turn this on." }];
  if (api.scenario === 'error') return [502, { ok: false, reason: 'apify', error: "The ad library check didn't work. Try again in a moment." }];
  if (api.scenario === 'comp-cap') return [429, { ok: false, reason: 'over-cap', error: "This week's $4 budget for competitor checks is used up. Checks come back Monday; earlier results in this tab still work." }];
  if (m === 'ads') { const d = DEMO.ads(body.query || '', { empty: api.scenario === 'empty' }); delete d.sample; return { ...d, cost: { usd: 0.015, results: 50, cached: false } }; }
  if (m === 'analyze') { const a = DEMO.analysis({ ads: body.ads || [], matchedPage: { pageName: body.target } }); delete a.sample; return { ...a, cost: { usd: 0.0021, cached: false } }; }
  return { ok: true };
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      let body = null; try { body = JSON.parse(raw || 'null'); } catch {}
      const out = apiReply(body, url.pathname);
      const [status, data] = Array.isArray(out) ? out : [200, out];
      setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); }, api.delay);
    });
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

// ─── Chrome over CDP ─────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-va-ui-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
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
const consoleErrors = [];
const FIXTURE_IMG = fs.readFileSync(path.join(ROOT, 'how-step-choose.webp'));
const FIXTURE_LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#0057B8"/></svg>');
const CLIP_BYTES = fs.readFileSync(CLIP_FILE);
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.g|favicon/.test(m.params.entry.url || '')) consoleErrors.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''));
  // External requests: thumbnails, clips and logos come from local fixtures; fonts pass through.
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    const u = request.url;
    const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
    if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1:')) send('Fetch.continueRequest', { requestId });
    else if (/^https:\/\/fixtures\.test\/clip/.test(u)) send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'video/webm' }, { name: 'Content-Length', value: String(CLIP_BYTES.length) }], body: CLIP_BYTES.toString('base64') });
    else if (/^https:\/\/fixtures\.test\//.test(u)) send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'image/webp' }], body: FIXTURE_IMG.toString('base64') });
    else if (/fonts\.(googleapis|gstatic)\.com|^data:|^blob:/.test(u)) send('Fetch.continueRequest', { requestId });
    else if (request.method === 'GET' && /\.(png|svg|webp|jpe?g|gif)(\?|$)/i.test(u)) send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'image/svg+xml' }], body: FIXTURE_LOGO.toString('base64') });
    else if (request.method === 'OPTIONS') send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [...cors, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' }], body: '' });
    else send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('null').toString('base64') });
  }
});
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });

// ─── The audit (runs in the page) ─────────────────────────────────────────
// Returns { fail: [...], warn: [...] }. Scope: the Video Ads page (#main) and its toasts.
const AUDIT = String.raw`(() => {
  const fail = [], warn = [];
  const roots = [document.getElementById('main'), document.getElementById('va-toasts')].filter(Boolean);
  const all = roots.flatMap(r => [r, ...r.querySelectorAll('*')]);
  const cs = e => getComputedStyle(e);
  const ariaHidden = e => Boolean(e.closest('[aria-hidden="true"]'));
  const vis = e => e && e.isConnected && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && (r => r.width > 0 && r.height > 0)(e.getBoundingClientRect());
  const srOnly = e => { for (let a = e; a && a !== document.body; a = a.parentElement) { const r = a.getBoundingClientRect(); const s = cs(a); if (r.width <= 2 || r.height <= 2 || s.clipPath !== 'none' || (s.clip && s.clip !== 'auto')) return true; } return false; };
  const label = e => { const id = e.id ? '#' + e.id : ''; const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const t = (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28); return e.tagName.toLowerCase() + id + cls + (t ? ' "' + t + '"' : ''); };
  const hasBox = e => { const s = cs(e); return parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderLeftWidth) >= 1 && s.borderTopStyle !== 'none' && rgba(s.borderTopColor)[3] > 0.05; };
  const ownText = e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  function rgba(str) { const m = String(str).match(/rgba?\(([^)]+)\)/); if (!m) { if (/^color\(srgb/.test(str)) { const p = str.match(/[\d.]+/g).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return [0, 0, 0, 0]; } const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  const visible = all.filter(e => vis(e) && !ariaHidden(e));
  const textEls = visible.filter(e => ownText(e) && !['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(e.tagName) && !srOnly(e));

  // 1 Doubled borders
  visible.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),textarea,select,.es-segmented') && hasBox(e)).forEach(i => {
    let a = i.parentElement;
    for (let d = 0; d < 3 && a && !roots.includes(a); d++, a = a.parentElement) {
      if (vis(a) && hasBox(a)) { const ri = i.getBoundingClientRect(), ra = a.getBoundingClientRect(); if (ra.height < ri.height + 24 && ra.width < ri.width + 60) { fail.push('doubled border: ' + label(i) + ' in ' + label(a)); break; } }
    }
  });

  // 2 Empty bands
  const MEDIA = 'img,svg,canvas,video,input,textarea,select,button,iframe,progress,meter,output';
  const hasContent = e => {
    if (e.matches(MEDIA)) return true;
    if (ownText(e)) return true;
    for (const k of e.querySelectorAll('*')) {
      if (!vis(k)) continue;
      if (k.matches(MEDIA) || ownText(k)) return true;
      const s = cs(k);
      if (s.backgroundImage !== 'none' || rgba(s.backgroundColor)[3] > 0.05) return true;
    }
    return cs(e).backgroundImage !== 'none';
  };
  visible.forEach(e => {
    if (e.matches(MEDIA) || roots.includes(e)) return;
    const r = e.getBoundingClientRect();
    if (r.height < 16 || r.width < 40 || hasContent(e)) return;
    const s = cs(e);
    if (s.position === 'absolute' || s.position === 'fixed') return; // overlays (scrims, drop cues) sit on content
    fail.push('empty band: ' + label(e) + ' (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')');
  });
  // A zero-size child in a flex / grid column adds a second gap.
  all.filter(e => vis(e) && !ariaHidden(e)).forEach(p => {
    const s = cs(p);
    if (!/flex|grid/.test(s.display)) return;
    const gap = parseFloat(s.rowGap) || 0;
    if (gap < 4 || (s.display.includes('flex') && !s.flexDirection.startsWith('column'))) return;
    const kids = [...p.children].filter(k => { const ks = cs(k); return ks.display !== 'none' && ks.position !== 'absolute' && ks.position !== 'fixed' && !k.hidden; });
    if (kids.length < 2) return;
    kids.forEach((k, i) => { const r = k.getBoundingClientRect(); const ks = cs(k); if (r.height === 0 && i > 0 && i < kids.length - 1 && parseFloat(ks.marginTop) + parseFloat(ks.marginBottom) > -gap + 0.5) fail.push('empty band: zero-size ' + label(k) + ' adds an extra ' + gap + 'px gap in ' + label(p)); });
  });

  // 3 Clipped text
  textEls.forEach(e => {
    const s = cs(e);
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return;
    if (s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && !/auto|scroll/.test(s.overflowX)) { fail.push('clipped text: ' + label(e) + ' (' + e.scrollWidth + ' > ' + e.clientWidth + ')'); return; }
    const range = document.createRange();
    const rects = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).flatMap(n => { range.selectNodeContents(n); return [...range.getClientRects()]; });
    if (!rects.length) return;
    const t = { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
    for (let a = e.parentElement, el = e; a && a !== document.documentElement; el = a, a = a.parentElement) {
      const as = cs(a);
      if (as.textOverflow === 'ellipsis' || as.webkitLineClamp !== 'none') return;
      const ar = a.getBoundingClientRect();
      const clipX = /hidden|clip/.test(as.overflowX), clipY = /hidden|clip/.test(as.overflowY);
      if (clipX && (t.right > ar.right + 1.5 || t.left < ar.left - 1.5)) { fail.push('clipped text: ' + label(e) + ' cut by ' + label(a)); return; }
      if (clipY && (t.bottom > ar.bottom + 1.5 || t.top < ar.top - 1.5)) { fail.push('clipped text: ' + label(e) + ' cut by ' + label(a)); return; }
      if (/auto|scroll/.test(as.overflowY) || /auto|scroll/.test(as.overflowX)) return; // inside a scroller: scrolled, not cut
    }
    const er = e.getBoundingClientRect();
    if (s.display !== 'inline' && (t.right > er.right + 2 || t.left < er.left - 2)) fail.push('text overflows its box: ' + label(e));
  });

  // 3b Text drawn over other text (badges colliding, labels under labels)
  // Each text's rects, cut to what its scrollers / clipping boxes show (text scrolled under a footer is not drawn there).
  const viewOf = e => { let v = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }; for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const s = cs(a); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const r = a.getBoundingClientRect(); v = { left: Math.max(v.left, r.left), top: Math.max(v.top, r.top), right: Math.min(v.right, r.right), bottom: Math.min(v.bottom, r.bottom) }; } } return v; };
  const pinOf = e => { for (let a = e; a && !roots.includes(a); a = a.parentElement) if (/sticky|fixed/.test(cs(a).position)) return a; return null; };
  const cut = (r, v) => ({ left: Math.max(r.left, v.left), top: Math.max(r.top, v.top), right: Math.min(r.right, v.right), bottom: Math.min(r.bottom, v.bottom) });
  const boxes = textEls.filter(e => !e.closest('.va-canvas-wrap, .va-toasts')).map(e => { const range = document.createRange(); const v = viewOf(e); const rs = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).flatMap(n => { range.selectNodeContents(n); return [...range.getClientRects()]; }).map(r => cut(r, v)).filter(r => r.right - r.left > 2 && r.bottom - r.top > 2); return { e, rs, pin: pinOf(e) }; }).filter(b => b.rs.length);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    if (a.pin !== b.pin) continue; // content scrolled under a sticky / fixed bar is hidden by it, not overlapping
    let hit = false;
    for (const ra of a.rs) { for (const rb of b.rs) { const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top); if (w > 3 && h > 3) { hit = true; break; } } if (hit) break; }
    if (hit) {
      // Only when both are actually painted there (not one scrolled under a sticky bar).
      fail.push('overlapping text: ' + label(a.e) + ' and ' + label(b.e));
    }
  }

  // 4 Horizontal page scroll
  const sw = document.documentElement.scrollWidth;
  if (sw > innerWidth + 1) {
    const wide = visible.filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(-1)[0];
    fail.push('horizontal scroll: page ' + sw + 'px wide at ' + innerWidth + (wide ? ' (' + label(wide) + ')' : ''));
  }

  // 5 Misaligned siblings
  const isBtn = k => k.matches('button,.es-btn,a.es-btn,[role=radio],[role=tab]') && (hasBox(k) || rgba(cs(k).backgroundColor)[3] > 0.05);
  const isCard = k => k.getBoundingClientRect().height >= 60 && (hasBox(k) || rgba(cs(k).backgroundColor)[3] > 0.05 || cs(k).boxShadow !== 'none');
  visible.forEach(p => {
    const s = cs(p);
    if (!/flex|grid/.test(s.display) || (s.display.includes('flex') && s.flexDirection.startsWith('column'))) return;
    const kids = [...p.children].filter(k => vis(k) && !ariaHidden(k) && !/absolute|fixed/.test(cs(k).position));
    const rows = new Map();
    kids.forEach(k => { const top = Math.round(k.getBoundingClientRect().top / 3); (rows.get(top) || rows.set(top, []).get(top)).push(k); });
    rows.forEach(row => {
      if (row.length < 2) return;
      const btns = row.filter(isBtn);
      if (btns.length >= 2) { const hs = btns.map(b => b.getBoundingClientRect().height); if (Math.max(...hs) - Math.min(...hs) > 1.5) fail.push('misaligned buttons: ' + btns.map(label).slice(0, 3).join(' / ') + ' heights ' + hs.map(Math.round).join('/')); }
      const cards = row.filter(k => !isBtn(k) && isCard(k));
      if (cards.length >= 2) {
        const hs = cards.map(c => c.getBoundingClientRect().height);
        if (Math.max(...hs) - Math.min(...hs) > 2) fail.push('misaligned cards: ' + label(p) + ' heights ' + hs.map(Math.round).join('/'));
        const acts = cards.map(c => c.querySelector('[class*="__actions"]')).filter(a => a && vis(a));
        if (acts.length === cards.length) { const ys = acts.map(a => a.getBoundingClientRect().bottom); if (Math.max(...ys) - Math.min(...ys) > 2) fail.push('misaligned card actions: ' + label(p)); }
      }
    });
  });

  // 6 Off-grid spacing (reported only)
  const offGrid = new Set();
  visible.forEach(e => {
    if (srOnly(e)) return;
    const s = cs(e);
    [['gap', s.rowGap], ['column-gap', s.columnGap], ['padding-top', s.paddingTop], ['padding-right', s.paddingRight], ['padding-bottom', s.paddingBottom], ['padding-left', s.paddingLeft]].forEach(([prop, v]) => {
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n === 0 || Math.abs(n / 4 - Math.round(n / 4)) < 0.01) return;
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '';
      offGrid.add((cls ? '.' + cls : e.tagName.toLowerCase()) + ' ' + prop + ' ' + v);
    });
  });
  offGrid.forEach(x => warn.push('off-grid: ' + x));

  // 7 Fonts and purple
  textEls.forEach(e => {
    if (e.closest('kbd,code,pre')) return;
    const fam = cs(e).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!/^(acumin|roboto)/i.test(fam)) fail.push('non-ES font: ' + label(e) + ' uses ' + fam);
  });
  const purple = c => { const [r, g, b, a] = rgba(c); if (a < 0.1) return false; const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn; if (d < 0.08) return false; const sat = d / (1 - Math.abs(2 * l - 1)); let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h = (h * 60 + 360) % 360; return h >= 255 && h <= 325 && sat > 0.3 && l > 0.12 && l < 0.9; };
  visible.forEach(e => { const s = cs(e); for (const [p, v] of [['color', s.color], ['background', s.backgroundColor], ['border', s.borderTopColor]]) if (purple(v) && !(p === 'border' && !hasBox(e)) && !(p === 'color' && !ownText(e) && e.tagName !== 'svg')) { fail.push('purple ' + p + ': ' + label(e) + ' ' + v); break; } });

  // 8 Unlabelled controls; one primary button per view
  const nameOf = e => {
    const by = (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim();
    return (e.getAttribute('aria-label') || by || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) ? '' : e.textContent) || e.getAttribute('title') || e.querySelector('img[alt]')?.alt || '').trim();
  };
  roots.flatMap(r => [...r.querySelectorAll('button,a[href],input:not([type=hidden]),textarea,select,summary,[role=button],[role=radio],[role=tab],[role=slider],[role=checkbox],[role=switch],[role=menuitem],[role=option]')]).forEach(e => {
    if (ariaHidden(e) || e.tabIndex < 0 && !vis(e)) return;
    const shown = vis(e) || (e.labels && [...e.labels].some(vis));
    if (shown && !nameOf(e)) fail.push('no accessible name: ' + label(e));
  });
  const prim = visible.filter(e => e.matches('.es-btn--primary') && !e.closest('.va-toast'));
  if (prim.length > 1) fail.push('primary buttons: ' + prim.length + ' visible (' + [...new Set(prim.map(p => (p.innerText || '').trim().slice(0, 20)))].slice(0, 4).join(', ') + ')');

  // 10 Broken images
  visible.filter(e => e.tagName === 'IMG' && e.complete && e.naturalWidth === 0).forEach(e => fail.push('broken image: ' + (e.getAttribute('src') || '').slice(0, 60)));

  // 11 Contrast
  const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  function bgOf(e) {
    let stack = [];
    for (let a = e; a; a = a.parentElement) {
      const s = cs(a);
      if (s.backgroundImage !== 'none' || ['CANVAS', 'VIDEO', 'IMG'].includes(a.tagName)) return null;
      if (parseFloat(s.opacity) < 1 && a !== e) return null;
      if (s.backdropFilter && s.backdropFilter !== 'none' && rgba(s.backgroundColor)[3] < 0.9) return null;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) stack.push(c);
      if (c[3] >= 0.999) break;
      if (a !== e && /absolute|fixed/.test(s.position) && c[3] < 0.999 && a.closest('.va-canvas-wrap,.va-clip__thumb')) return null;
    }
    let bg = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  }
  textEls.forEach(e => {
    if (e.closest('button:disabled,[aria-disabled="true"],input:disabled,.is-disabled')) return;
    const s = cs(e);
    if (e.closest('.va-canvas-wrap,.va-clip__thumb,.va-device')) return; // drawn over the live ad / a thumbnail
    const bg = bgOf(e);
    if (!bg) return;
    const fg = over(rgba(s.color), bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize), w = parseInt(s.fontWeight, 10);
    const need = px >= 24 || (px >= 18.66 && w >= 700) ? 3 : 4.5;
    if (ratio < need - 0.05) fail.push('low contrast ' + ratio.toFixed(2) + ':1 (needs ' + need + '): ' + label(e));
  });
  return { fail: [...new Set(fail)], warn: [...new Set(warn)] };
})()`;

// ─── Driving the page ─────────────────────────────────────────────────────
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); sessionStorage.clear(); sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); return true; })()`;
async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
}
async function load(page = '/video-ads.html') {
  await send('Page.navigate', { url: `${base}/__blank` });
  for (let i = 0; i < 40 && (await evaluate('location.href').catch(() => '')) !== `${base}/__blank`; i++) await sleep(100);
  await evaluate(SESSION);
  await send('Page.navigate', { url: `${base}${page}` });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const ok = await evaluate("Boolean(document.querySelector('#va-styles [role=radio]')) && document.documentElement.style.visibility !== 'hidden' && !/login/.test(location.pathname)").catch(() => false);
    if (ok) break;
  }
  const where = await evaluate('location.pathname');
  if (!/video-ads/.test(where)) throw new Error('page went to ' + where + ' (sign-in gate)');
  // No animations: measure settled layouts.
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}'; document.head.append(s); return true; })()`);
  await sleep(400);
}
const theme = t => evaluate(`(() => { if (window.FrameUpTheme?.apply) window.FrameUpTheme.apply(${JSON.stringify(t)}); else document.documentElement.dataset.theme = ${JSON.stringify(t)}; return document.documentElement.dataset.theme; })()`);
async function shot(name) {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (r.result?.data) fs.writeFileSync(path.join(SHOTS, name.replace(/[^\w.-]+/g, '_') + '.png'), Buffer.from(r.result.data, 'base64'));
}

// ─── The states ───────────────────────────────────────────────────────────
// Each state: js runs in the page (may be async); `until` is polled (≤ 6 s);
// `expect` must return true (or a failure message): the behaviour check.
const H = String.raw`window.__va = window.__va || (() => {
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const click = s => { const e = typeof s === 'string' ? $(s) : s; if (!e) throw new Error('missing ' + s); e.click(); return e; };
  const step = id => click('.va-step[data-step="' + id + '"]');
  const tab = id => click('[data-tab="' + id + '"]');
  const type = (s, v) => { const e = $(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  const aiOpen = () => { if ($('#va-ai').hidden) click('#va-ask-ai'); };
  const text = s => ($(s)?.innerText || '').trim();
  return { $, sleep, click, step, tab, type, aiOpen, text };
})()`;
const S = [
  // Copy
  { name: 'copy/default', js: `__va.step('copy')`, expect: `__va.$('[data-pane=copy]').hidden === false && __va.$('#va-styles [aria-checked=true]') ? true : 'copy pane or picked style missing'` },
  ...['simple', 'condensed', 'highlight', 'today3', 'versus'].map(st => ({ name: `copy/style-${st}`, js: `__va.click('#va-styles [data-style="${st}"]')`, expect: `__va.$('#va-styles [data-style="${st}"]').getAttribute('aria-checked') === 'true' || 'style ${st} did not select'` })),
  { name: 'copy/style-fields-filled', js: `(async () => { __va.click('#va-styles [data-style="today3"]'); await __va.sleep(100); document.querySelectorAll('#va-style-fields input, #va-style-fields textarea').forEach((e, i) => { e.value = 'Line ' + (i + 1) + ' with a fairly long headline that wraps'; e.dispatchEvent(new Event('input', { bubbles: true })); }); return true; })()` },
  { name: 'copy/style-highlight', js: `__va.click('#va-styles [data-style="highlight"]')` },
  ...['essentially-cfb', 'es-dugout', 'the-huddle'].map(b => ({ name: `copy/brand-${b}`, js: `__va.click('#va-brands [data-brand="${b}"]')`, expect: `__va.$('#va-brands [data-brand="${b}"]').getAttribute('aria-checked') === 'true' || 'brand did not switch'` })),
  { name: 'copy/zone-classic', js: `__va.click('#va-zone [data-zone="classic"]')`, expect: `__va.$('#va-zone [data-zone="classic"]').getAttribute('aria-checked') === 'true' || 'zone did not switch'` },
  { name: 'copy/lint', js: `(async () => { __va.click('#va-zone [data-zone="meta"]'); __va.type('#va-headline', 'AMAZING deal ,now!!! THE BEST newsletter EVER for every single fan of the game who wants more'); __va.type('#va-highlight', 'not in it'); __va.click('#va-add-para'); __va.type('#va-cta', 'CLICK HERE NOW'); return true; })()`, expect: `!__va.$('#va-highlight-warn').hidden || 'highlight warning did not show'` },
  { name: 'copy/ai-open', js: `(async () => { __va.type('#va-headline', 'The college football team you were handed. Keep up with it, free.'); __va.type('#va-highlight', 'Keep up with it, free.'); __va.type('#va-cta', ''); __va.aiOpen(); return true; })()`, expect: `!__va.$('#va-ai').hidden || 'Ask AI did not open'` },
  { name: 'copy/ai-context', js: `(async () => { __va.$('#va-ai-context').open = true; __va.$('#va-moment-fold').open = true; __va.$('#va-moment-fold').dispatchEvent(new Event('toggle')); return true; })()`, until: `!document.querySelector('#va-copy-moments .va-working')` },
  { name: 'copy/ai-options', js: `__va.click('[data-ai="write"]')`, until: `document.querySelectorAll('#va-variants button, #va-variants [data-variant]').length > 0`, expect: `__va.$('#va-variants').children.length > 0 || 'Write 3 options showed nothing'` },
  { name: 'copy/ai-grammar', js: `__va.click('[data-ai="grammar"]')`, until: `__va.text('#va-grammar').length > 0 && !/Checking/.test(__va.text('#va-grammar'))`, expect: `__va.text('#va-grammar').length > 0 || 'grammar check showed nothing'` },
  { name: 'copy/ai-chat', js: `__va.click('[data-ai="shorten"]')`, until: `document.querySelectorAll('#va-thread li').length >= 2 && !__va.$('#va-thread .is-pending, #va-thread [aria-busy=true]')`, expect: `/shorter/.test(__va.text('#va-thread')) || 'chat reply missing'` },
  { name: 'copy/ai-error', scenario: 'error', js: `__va.click('[data-ai="write"]')`, until: `/unavailable|wrong/i.test(__va.text('#va-ai-out'))`, expect: `/unavailable|wrong/i.test(__va.text('#va-ai-out')) || 'AI error not shown'` },
  { name: 'copy/set-loading', delay: 2500, js: `(async () => { __va.click('#va-ai-close'); __va.click('#va-set-make'); await __va.sleep(500); return true; })()`, expect: `__va.$('#va-set-make').disabled || /Making|Writing|…/.test(__va.text('#va-set')) || 'no loading state on Make my daily set'` },
  { name: 'copy/set-done', js: `true`, until: `__va.$('#va-set-body').children.length > 0 && !/Making|Writing/.test(__va.text('#va-set-make'))`, expect: `__va.$('#va-set-body').children.length > 0 || 'daily set empty'` },
  { name: 'copy/set-error', scenario: 'error', js: `__va.click('#va-set-make')`, until: `/unavailable|wrong|Try/i.test(__va.text('#va-set-body'))` },
  // Clip
  { name: 'clip/team', js: `__va.step('clip')`, until: `document.querySelectorAll('#va-team-list [data-team]').length > 0`, expect: `__va.$('[data-pane=clip]').hidden === false || 'clip pane missing'` },
  { name: 'clip/team-multi', js: `(async () => { const names = [...document.querySelectorAll('#va-team-list [data-team]')].slice(0, 3).map(b => b.dataset.team); for (const n of names) { const b = [...document.querySelectorAll('#va-team-list [data-team]')].find(x => x.dataset.team === n); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); await __va.sleep(30); } return true; })()`, expect: `document.querySelectorAll('#va-team-list [aria-pressed=true]').length >= 2 || 'multi-team pick failed'` },
  { name: 'clip/team-search-none', js: `__va.type('#va-team-q', 'zzzz')` },
  { name: 'clip/team-loading', delay: 2500, js: `(async () => { __va.type('#va-team-q', ''); __va.click('#va-team-find'); await __va.sleep(300); return true; })()` },
  { name: 'clip/team-results', js: `true`, until: `document.querySelectorAll('#va-found [data-mo-use]').length > 0`, expect: `document.querySelectorAll('#va-found [data-mo-use]').length > 0 || 'team search showed no clips'` },
  { name: 'clip/team-angles', js: `__va.click('#va-found [data-mo-angles]')`, expect: `__va.$('#va-found .va-mo-alts') ? true : 'angles did not open'` },
  { name: 'clip/team-empty', scenario: 'empty', js: `__va.click('#va-team-find')`, until: `!document.querySelector('#va-found .va-shimmer') && __va.text('#va-found').length > 0` },
  { name: 'clip/team-error', scenario: 'error', js: `__va.click('#va-team-find')`, until: `!document.querySelector('#va-found .va-shimmer') && /wrong|unavailable|Try/i.test(__va.text('#va-found'))` },
  { name: 'clip/color', js: `__va.tab('color')`, expect: `!__va.$('#va-by-color').hidden || 'colour tab did not open'` },
  { name: 'clip/color-multi', js: `(async () => { [...document.querySelectorAll('#va-swatches [data-color]')].slice(1, 4).forEach(b => b.click()); return true; })()`, expect: `document.querySelectorAll('#va-swatches [aria-checked=true]').length >= 2 || 'multi-colour pick failed'` },
  { name: 'clip/color-results', js: `__va.click('#va-find')`, until: `document.querySelectorAll('#va-found [data-mo-use]').length > 0` },
  { name: 'clip/color-empty', scenario: 'empty', js: `__va.click('#va-find')`, until: `!document.querySelector('#va-found .va-shimmer') && __va.text('#va-found').length > 0` },
  { name: 'clip/color-error', scenario: 'error', js: `__va.click('#va-find')`, until: `!document.querySelector('#va-found .va-shimmer') && /wrong|unavailable|Try/i.test(__va.text('#va-found'))` },
  { name: 'clip/moment-loading', delay: 2500, js: `(async () => { __va.tab('moment'); await __va.sleep(300); return true; })()` },
  { name: 'clip/moment', js: `true`, until: `document.querySelectorAll('#va-trends [data-mo-use]').length > 0`, expect: `document.querySelectorAll('#va-trends [data-mo-use]').length > 0 || 'moments showed no plays'` },
  { name: 'clip/moment-empty', scenario: 'empty', js: `__va.click('#va-refresh')`, until: `!__va.$('#va-refresh').classList.contains('is-spinning') && !document.querySelector('#va-trends .va-shimmer')` },
  { name: 'clip/moment-error', scenario: 'error', js: `__va.click('#va-refresh')`, until: `!__va.$('#va-refresh').classList.contains('is-spinning') && !document.querySelector('#va-trends .va-shimmer')` },
  { name: 'clip/library', js: `__va.tab('library')`, until: `document.querySelectorAll('#va-lib-found [data-mo-use], #va-lib-found [data-clip], #va-lib-found button').length > 0`, expect: `!__va.$('#va-by-library').hidden || 'library did not open'` },
  { name: 'clip/library-empty', scenario: 'empty', js: `__va.click('#va-lib-sport [data-sport="mlb"]')`, until: `!document.querySelector('#va-lib-found .va-shimmer')` },
  { name: 'clip/library-error', scenario: 'error', js: `__va.click('#va-lib-sport [data-sport="nfl"]')`, until: `!document.querySelector('#va-lib-found .va-shimmer')` },
  { name: 'clip/link', js: `__va.tab('link')`, expect: `!__va.$('#va-by-link').hidden || 'link tab did not open'` },
  { name: 'clip/link-empty-submit', js: `(async () => { __va.type('#va-xurl', ''); __va.$('#va-xform').requestSubmit(); return true; })()`, expect: `!__va.$('#va-linkres').hidden || 'empty link gave no message'` },
  { name: 'clip/link-blocked', js: `(async () => { __va.type('#va-xurl', 'https://www.youtube.com/watch?v=abc'); __va.$('#va-xform').requestSubmit(); return true; })()`, expect: `/YouTube/i.test(__va.text('#va-linkres')) || 'YouTube link not explained'` },
  { name: 'clip/link-error', scenario: 'error', js: `(async () => { __va.type('#va-xurl', 'https://x.com/nfl/status/1'); __va.$('#va-xform').requestSubmit(); return true; })()`, until: `!/Getting|Finding|…/.test(__va.text('#va-linkres'))` },
  { name: 'clip/link-ok', js: `(async () => { __va.type('#va-xurl', 'https://x.com/nfl/status/2'); __va.$('#va-xform').requestSubmit(); return true; })()`, until: `document.getElementById('va-video').videoWidth > 0 && __va.$('#va-busy').hidden`, expect: `document.getElementById('va-video').videoWidth > 0 || 'link clip did not load'` },
  // Stage with a clip
  { name: 'stage/clip-from-results', js: `(async () => { __va.tab('team'); await __va.sleep(50); __va.click('#va-team-find'); return true; })()`, until: `document.querySelectorAll('#va-found [data-mo-use]:not([disabled])').length > 0` },
  { name: 'stage/clip-in-ad', js: `__va.click('#va-found [data-mo-use]:not([disabled])')`, until: `__va.$('#va-busy').hidden && /Using it/.test(__va.text('#va-found'))`, expect: `/Using it/.test(__va.text('#va-found')) || 'Use clip did not put the clip in the ad'` },
  { name: 'stage/play', js: `(async () => { __va.click('#va-play'); await __va.sleep(400); return true; })()`, expect: `!document.getElementById('va-video').paused || 'Play did not play'` },
  { name: 'stage/pause', js: `(async () => { __va.click('#va-play'); return true; })()`, expect: `document.getElementById('va-video').paused || 'Pause did not pause'` },
  ...['4x5', '1x1', '9x16'].map(z => ({ name: `stage/size-${z}`, js: `__va.click('#va-sizes [data-size="${z}"]')`, expect: `__va.$('#va-sizes [data-size="${z}"]').getAttribute('aria-checked') === 'true' || 'size did not switch'` })),
  ...['9x16', '4x5', '1x1'].map(z => ({ name: `stage/meta-${z}`, js: `(async () => { if (__va.$('#va-meta-toggle').getAttribute('aria-pressed') !== 'true') __va.click('#va-meta-toggle'); __va.click('#va-sizes [data-size="${z}"]'); return true; })()`, expect: `__va.$('#va-meta-toggle').getAttribute('aria-pressed') === 'true' || 'Meta preview did not turn on'` })),
  { name: 'stage/safe-zone', js: `(async () => { __va.click('#va-meta-toggle'); __va.click('#va-sizes [data-size="9x16"]'); __va.click('#va-safe-toggle'); return true; })()`, expect: `!__va.$('#va-safe').hidden || 'safe zone did not show'` },
  { name: 'stage/rail-frame', js: `(async () => { __va.click('#va-safe-toggle'); const t = __va.$('[data-rail="frame"]'); if (getComputedStyle(t).display !== 'none' && t.getAttribute('aria-expanded') !== 'true') t.click(); return true; })()` },
  { name: 'stage/rail-tint', js: `(async () => { const t = __va.$('[data-rail="tint"]'); if (getComputedStyle(t).display !== 'none') t.click(); __va.click('#va-tint-colors button:nth-child(3)'); return true; })()` },
  { name: 'stage/zoomed', js: `(async () => { __va.click('#va-zoom-in'); __va.click('#va-zoom-in'); return true; })()`, expect: `__va.$('#va-zoom-val').textContent !== '100%' || 'zoom in did nothing'` },
  // Export
  { name: 'export/default', js: `(async () => { __va.click('#va-look-reset'); __va.step('export'); return true; })()`, expect: `!__va.$('#va-export').disabled || 'Export is disabled with a clip in the ad'` },
  { name: 'export/sizes-all', js: `(async () => { document.querySelectorAll('#va-exsizes [aria-pressed=false]').forEach(b => b.click()); return true; })()`, expect: `document.querySelectorAll('#va-exsizes [aria-pressed=true]').length === 3 || 'size toggles failed'` },
  { name: 'export/sound-original', js: `__va.click('#va-sound-mode [data-sound="original"]')` },
  { name: 'export/sound-music', js: `__va.click('#va-sound-mode [data-sound="library"]')`, until: `__va.text('#va-sound-body').length > 0 && !/Loading/.test(__va.text('#va-sound-body'))` },
  { name: 'export/sound-upload', js: `__va.click('#va-sound-mode [data-sound="upload"]')` },
  { name: 'export/grid', js: `(async () => { __va.click('#va-sound-mode [data-sound="muted"]'); __va.click('#va-grid'); return true; })()`, expect: `!__va.$('#va-grid-styles').hidden || 'Export 3 styles did not open its picker'` },
  { name: 'export/preflight', js: `(async () => { __va.click('#va-grid'); __va.click('#va-check'); return true; })()`, until: `__va.text('#va-preflight-out').length > 0`, expect: `__va.text('#va-preflight-out').length > 0 || 'Check this ad showed nothing'` },
  // A real MP4 recording (the clip is 3.5 s): 1440 only, to keep the run short.
  { name: 'export/exporting', vp: [1440], js: `(async () => { document.querySelectorAll('#va-exsizes [aria-pressed=true]').forEach((b, i) => { if (b.dataset.ex !== '9x16') b.click(); }); __va.click('#va-export'); await __va.sleep(700); return true; })()`, expect: `!__va.$('#va-export-progress').hidden || /Recording|Exporting|%/.test(__va.text('#va-export-status')) || 'Export showed no progress'` },
  { name: 'export/done', vp: [1440], js: `true`, until: `!__va.$('#va-files').hidden`, wait: 30000, expect: `__va.$('#va-files').children.length > 0 || 'Export finished with no file listed'` },
  { name: 'export/set-mode', js: `(async () => { __va.step('copy'); __va.click('#va-set-make'); for (let i = 0; i < 40 && !__va.$('#va-set-body').children.length; i++) await __va.sleep(100); await __va.sleep(200); __va.step('export'); return true; })()`, until: `!__va.$('#va-exmode-row').hidden`, expect: `!__va.$('#va-exmode-row').hidden || 'set export mode missing after making a set'` },
  // Empty: no clip yet (fresh page), and free mode (AI over budget)
  { name: 'fresh/export-no-clip', reload: true, js: `__va.step('export')`, expect: `__va.$('#va-export').disabled || /clip|animate/i.test(__va.text('#va-ready')) || 'no-clip export state unclear'` },
  { name: 'fresh/animated', js: `(async () => { __va.click('#va-empty-animated'); return true; })()`, until: `__va.$('#va-busy').hidden`, expect: `!__va.$('#va-play').disabled || 'No clip? Animate gave nothing to play'` },
  // Competitor ads: sample data (localhost), then the live API path (?demo=off).
  { name: 'comp/sample-open', reload: true, js: `__va.click('#va-comp-open')`, expect: `!__va.$('#va-comp').hidden && __va.$('.va-work').hidden && __va.$('#va-comp-demo') ? true : 'Competitor ads did not open with the sample-data bar'` },
  { name: 'comp/sample-results', js: `__va.click('#va-comp-picks [data-pick="Sample Sports Daily"]')`, until: `document.querySelectorAll('#va-comp-out .va-comp-ad').length > 0 && !document.querySelector('#va-comp-out [aria-busy=true]')`, wait: 9000, expect: `document.querySelectorAll('.va-comp-stat').length === 7 && /Sample data/.test(__va.text('#va-comp-out')) || 'sample results or summary missing'` },
  ...['testing', 'trends', 'notWorking', 'ideas', 'all'].map(id => ({ name: `comp/sample-${id}`, js: `__va.click('#va-comp-tab-${id}')`, expect: `__va.$('#va-comp-tab-${id}').getAttribute('aria-selected') === 'true' && __va.text('#va-comp-sec').length > 20 || 'section ${id} empty'` })),
  { name: 'comp/sample-error', js: `(async () => { const s = __va.$('#va-comp-demo-state'); s.value = 'error'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, until: `/didn’t work/.test(__va.text('#va-comp-out'))` },
  { name: 'comp/use-idea', js: `(async () => { const s = __va.$('#va-comp-demo-state'); s.value = 'live'; s.dispatchEvent(new Event('change', { bubbles: true })); for (let i = 0; i < 60 && !document.querySelector('[data-comp-sec=ideas] .va-comp-tab__n'); i++) await __va.sleep(100); __va.click('#va-comp-tab-ideas'); __va.click('[data-use-idea="0"]'); return true; })()`, until: `__va.$('#va-comp').hidden`, expect: `window.VideoAdsPage.state.brandId === 'the-huddle' && window.VideoAdsPage.state.style === 'highlight' && /one short email/.test(window.VideoAdsPage.state.headline) && __va.$('#va-headline').value === window.VideoAdsPage.state.headline || 'Use this idea did not fill the copy'` },
  { name: 'comp/use-idea-undo', js: `(async () => { window.VideoAdsPage.undo(); return true; })()`, expect: `!/one short email/.test(window.VideoAdsPage.state.headline) || 'Undo did not put the copy back'` },
  { name: 'comp/not-set-up', reload: true, page: '/video-ads.html?demo=off', scenario: 'comp-off', js: `__va.click('#va-comp-open')`, until: `!__va.$('#va-comp-setup').hidden`, expect: `/APIFY_TOKEN in Vercel/.test(__va.text('#va-comp-setup')) && __va.$('#va-comp-check').disabled && !__va.$('#va-comp-demo') || 'not-set-up state missing'` },
  { name: 'comp/idle', reload: true, page: '/video-ads.html?demo=off', js: `__va.click('#va-comp-open')`, until: `/per check/.test(__va.text('#va-comp-cost'))`, expect: `/About \\$0\\.015 per check/.test(__va.text('#va-comp-cost')) || 'estimated cost not shown before running'` },
  { name: 'comp/empty-input', js: `(async () => { __va.type('#va-comp-q', ''); __va.$('#va-comp-form').requestSubmit(); return true; })()`, expect: `__va.$('#va-comp-q').getAttribute('aria-invalid') === 'true' || 'empty check not explained'` },
  { name: 'comp/loading', delay: 2500, js: `(async () => { __va.type('#va-comp-q', 'Sample Gridiron Brief'); __va.$('#va-comp-form').requestSubmit(); await __va.sleep(400); return true; })()`, expect: `/Checking/.test(__va.text('#va-comp-out')) && __va.$('#va-comp-check').disabled || 'no loading state'` },
  { name: 'comp/results', js: `true`, until: `document.querySelectorAll('#va-comp-out .va-comp-ad').length > 0 && !document.querySelector('#va-comp-out [aria-busy=true]')`, wait: 9000, expect: `/Cost \\$0\\.015/.test(__va.text('#va-comp-out')) || 'real cost not shown after running'` },
  { name: 'comp/results-ideas', js: `__va.click('#va-comp-tab-ideas')`, expect: `document.querySelectorAll('[data-use-idea]').length === 5 || 'ideas missing'` },
  { name: 'comp/empty', scenario: 'empty', js: `(async () => { __va.type('#va-comp-q', 'Nobody'); __va.$('#va-comp-form').requestSubmit(); return true; })()`, until: `/No live ads found/.test(__va.text('#va-comp-out'))` },
  { name: 'comp/error', scenario: 'error', js: `(async () => { __va.type('#va-comp-q', 'Broken'); __va.$('#va-comp-form').requestSubmit(); return true; })()`, until: `/didn’t work/.test(__va.text('#va-comp-out'))`, expect: `__va.$('#va-comp-out [data-comp-retry]') ? true : 'no retry on error'` },
  { name: 'comp/over-cap', scenario: 'comp-cap', js: `(async () => { __va.type('#va-comp-q', 'Capped'); __va.$('#va-comp-form').requestSubmit(); return true; })()`, until: `/Weekly limit/.test(__va.text('#va-comp-out'))` },
  { name: 'comp/close', js: `(async () => { __va.click('#va-comp-close'); return true; })()`, expect: `__va.$('#va-comp').hidden && !__va.$('.va-work').hidden && document.activeElement === __va.$('#va-comp-open') || 'Back to your ad did not return'` },
  { name: 'free/copy', reload: true, scenario: 'free', js: `(async () => { __va.step('copy'); __va.aiOpen(); __va.click('[data-ai="write"]'); return true; })()`, until: `document.documentElement.dataset.aiMode === 'free' && !__va.$('#va-ai-progress').checkVisibility()` },
  { name: 'free/set', scenario: 'free', js: `(async () => { __va.click('#va-ai-close'); __va.click('#va-set-make'); return true; })()`, until: `__va.$('#va-set-body').children.length > 0` },
];

// Canary: plant one of each defect in the page and make sure the audit sees it,
// so a check that silently stops working fails here instead of passing.
const CANARY = String.raw`(() => {
  const box = document.createElement('div');
  box.id = 'va-canary';
  box.style.cssText = 'position:relative;width:300px;background:#fff;color:#111;font-family:Roboto';
  box.innerHTML = '<div style="display:inline-block;border:1px solid #333;padding:2px"><input type="text" aria-label="x" style="border:1px solid #333;width:200px"></div>'
    + '<div style="height:40px;width:200px;border:1px solid #ccc"></div>'
    + '<div style="width:60px;overflow:hidden;white-space:nowrap">This label is far too long to fit</div>'
    + '<div style="display:flex"><button style="height:30px;border:1px solid #000">A</button><button style="height:40px;border:1px solid #000">B</button></div>'
    + '<p style="color:#7a2bd6">Purple words</p><p style="color:#bbb">Faint words</p><p style="font-family:Comic Sans MS">Odd face</p>'
    + '<button style="border:1px solid #000;width:20px;height:20px"></button><img src="/__missing.png" width="20" height="20" alt="">'
    + '<div style="position:relative;height:20px"><span style="position:absolute;left:0">Overlap one</span><span style="position:absolute;left:10px">Overlap two</span></div>'
    + '';
  document.getElementById('main').prepend(box);
  const wide = document.createElement('div'); wide.style.cssText = 'width:3000px;height:4px;background:#000'; document.body.append(wide);
  return new Promise(r => setTimeout(r, 300));
})()`;
const CANARY_WANT = ['doubled border', 'empty band', 'clipped text', 'misaligned buttons', 'purple', 'low contrast', 'non-ES font', 'no accessible name', 'broken image', 'overlapping text', 'horizontal scroll'];

const VIEWPORTS = [[1440, 900], [1024, 768], [375, 812]];
const only = process.env.VA_ONLY || '';
const results = []; // { vp, theme, state, fail[], warn[] }
const behaviour = [];
let states = 0;
try {
  for (const [w, h] of VIEWPORTS) {
    if (only && /^\d/.test(only) && !only.startsWith(String(w))) continue;
    await viewport(w, h);
    for (const st of S) {
      if (st.vp && !st.vp.includes(w)) continue;
      if (st === S[0] || st.reload) { api.scenario = 'ok'; api.delay = 0; await load(st.page); await evaluate(H); }
      if (st === S[0] && w === VIEWPORTS.find(v => !only || !/^\d/.test(only) || only.startsWith(String(v[0])))[0]) {
        await evaluate(CANARY);
        const r = await evaluate(AUDIT);
        const missed = CANARY_WANT.filter(k => !r.fail.some(f => f.includes(k)));
        if (missed.length) behaviour.push(`audit canary: the check no longer catches ${missed.join(', ')}`);
        await load(); await evaluate(H);
      }
      api.scenario = st.scenario || 'ok'; api.delay = st.delay || 0;
      const errAt = consoleErrors.length;
      try { await evaluate(st.js); } catch (e) { behaviour.push(`${w} ${st.name}: action failed: ${e.message.split('\n')[0]}`); }
      if (st.until) { let ok = false; for (let i = 0; i < (st.wait || 6000) / 150 && !ok; i++) { await sleep(150); ok = await evaluate(st.until).catch(() => false); } if (!ok) behaviour.push(`${w} ${st.name}: never reached its state (${st.until.slice(0, 80)})`); }
      await sleep(st.delay ? 0 : 250);
      if (st.expect && w === 1440) { const r = await evaluate(st.expect).catch(e => e.message); if (r !== true) behaviour.push(`${w} ${st.name}: ${r}`); }
      if (process.env.VA_DEBUG_STATE === st.name) { await theme(process.env.VA_DEBUG_THEME || 'light'); console.log('debug', st.name, JSON.stringify(await evaluate(process.env.VA_DEBUG_EXPR), null, 1)); }
      for (const t of ['light', 'dark']) {
        const tag = `${w}-${t}`;
        if (only && !tag.startsWith(only) && !st.name.startsWith(only)) continue;
        await theme(t); await sleep(80);
        let r = await evaluate(AUDIT);
        if (r.fail.length) { await sleep(600); r = await evaluate(AUDIT); } // settle once
        states++;
        results.push({ vp: w, theme: t, state: st.name, fail: r.fail, warn: r.warn });
        if (SHOTS && (r.fail.length || process.env.VA_ALLSHOTS)) await shot(`${w}-${t}-${st.name}`);
      }
      await theme('light');
      // The error scenario's own stubbed 500s are expected; anything else is a real error.
      const errs = consoleErrors.slice(errAt).filter(e => !/supabase\.co|ERR_FAILED|net::ERR/.test(e) && !(st.scenario === 'error' && /status of 500/.test(e)) && !(['error', 'comp-cap', 'comp-off'].includes(st.scenario) && /status of (429|502|503).*\/api\/meta-ads/.test(e)));
      if (errs.length) results.push({ vp: w, theme: '-', state: st.name, fail: errs.map(e => 'console: ' + e), warn: [] });
      api.delay = 0;
    }
    if (Date.now() - T0 > 230000 && w !== VIEWPORTS[VIEWPORTS.length - 1][0]) console.log('video ads ui: note, over 230 s');
  }
} finally { ws.close(); cleanup(); }

// ─── Report ─────────────────────────────────────────────────────────────
const byIssue = new Map();
results.forEach(r => r.fail.forEach(f => { const k = f; if (!byIssue.has(k)) byIssue.set(k, []); byIssue.get(k).push(`${r.vp}/${r.theme}/${r.state}`); }));
const warns = new Set(results.flatMap(r => r.warn));
byIssue.forEach((where, issue) => console.log(`FAIL ${issue}\n     at ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` +${where.length - 4} more` : ''}`));
behaviour.forEach(b => console.log(`FAIL behaviour: ${b}`));
if (process.env.VA_WARN) [...warns].sort().forEach(w => console.log(`warn ${w}`));
const secs = Math.round((Date.now() - T0) / 1000);
const failed = byIssue.size + behaviour.length;
console.log(`video ads ui: ${states} states swept (${S.length} states × up to ${VIEWPORTS.length} sizes × light/dark) in ${secs}s; ${byIssue.size} layout issue(s), ${behaviour.length} behaviour issue(s), ${warns.size} off-grid spacing note(s)`);
process.exit(failed ? 1 : 0);
