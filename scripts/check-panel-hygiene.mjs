// Panel hygiene: sweeps every template of the editor (Social, YouTube,
// Newsletter) in light and dark, in real headless Chrome, and fails on:
//   - a field drawn as a box inside a box (doubled border)
//   - a panel section left as an empty band between two dividers
// Run: node scripts/check-panel-hygiene.mjs   (skips if Chrome isn't installed)
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
if (!CHROME) { console.log('panel hygiene: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('panel hygiene: skipped (needs Node with WebSocket)'); process.exit(0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-hygiene-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (process.env.HYG_DEBUG && m.method === 'Page.frameNavigated' && !m.params.frame.parentId) console.log('nav', m.params.frame.url); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
// A fake, unexpired, unsigned session: only the page's own gate reads it (APIs are stubbed).
await evaluate(`(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`);

const SWEEP = `(async (theme, ws) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.documentElement.setAttribute('data-theme', theme);
  if (location.hash !== '#' + ws) { location.hash = ws; await sleep(1500); }
  const vis = e => { if (!e || !e.isConnected) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const hasBox = e => { const s = getComputedStyle(e); return parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderLeftWidth) >= 1 && s.borderTopStyle !== 'none'; };
  const panel = () => document.querySelector('.app[data-workspace] > .panel') || document.querySelector('.panel');
  function scan() {
    const p = panel(); const issues = [];
    if (!p) return ['no panel'];
    p.querySelectorAll('input[type=text],input[type=url],input[type=number],input[type=email],input:not([type]),textarea,select').forEach(i => {
      if (!vis(i) || !hasBox(i) || i.closest('#infographic-fields,#listicle-type2-fields')) return;
      let a = i.parentElement;
      for (let d = 0; d < 3 && a && a !== p; d++, a = a.parentElement) {
        if (vis(a) && hasBox(a)) { const ri = i.getBoundingClientRect(), ra = a.getBoundingClientRect(); if (ra.height < ri.height + 24 && ra.width < ri.width + 60) { issues.push('doubled border: #' + (i.id || i.name || i.className.split(' ')[0])); break; } }
      }
    });
    p.querySelectorAll('.studio-dock-section').forEach(s => { if (vis(s) && ![...s.children].some(k => vis(k) && !k.classList.contains('fi-section-title'))) issues.push('empty section band'); });
    return issues;
  }
  const out = {};
  const pickers = ['#newsletter-asset-select', '#instagram-post-type', '#youtube-variation'].map(q => document.querySelector(q)).filter(Boolean).filter(vis);
  const pick = pickers[0] || [...document.querySelectorAll('.panel select')].filter(vis).find(s => s.options.length > 1 && s.options.length < 60);
  const options = pick ? [...pick.options].map(o => o.value) : [''];
  for (const v of options) {
    if (pick) { pick.value = v; pick.dispatchEvent(new Event('change', { bubbles: true })); await sleep(700); }
    const is = scan();
    if (is.length) out[(v || ws)] = [...new Set(is)];
  }
  return { templates: options.length, problems: out };
})`;

await send('Page.navigate', { url: `${base}/index.html#newsletter` });
for (let i = 0; i < 60; i++) { await sleep(500); const ok = await evaluate("Boolean(document.querySelector('.app[data-workspace] > .panel')) && document.documentElement.style.visibility !== 'hidden'"); if (ok) break; }
const where = await evaluate('location.pathname + location.search + location.hash');
const hasPanel = await evaluate("Boolean(document.querySelector('.app[data-workspace] > .panel'))");
if (!hasPanel || /login/.test(where)) { console.log('panel hygiene: page went to ' + where + ' (sign-in gate) — cannot sweep'); ws.close(); chrome.kill(); server.close(); process.exit(1); }
let failed = 0; let swept = 0;
for (const theme of ['light', 'dark']) {
  for (const ws of ['instagram', 'youtube', 'newsletter']) {
    const r = await evaluate(`${SWEEP}(${JSON.stringify(theme)}, ${JSON.stringify(ws)})`);
    swept += r?.templates || 0;
    const keys = Object.keys(r?.problems || {});
    if (keys.length) { failed += keys.length; keys.forEach(k => console.log(`FAIL ${theme}/${ws}/${k}: ${r.problems[k].join('; ')}`)); }
  }
}
ws.close(); chrome.kill(); server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
if (failed) { console.log(`panel hygiene: ${failed} template state(s) with problems (${swept} swept)`); process.exit(1); }
console.log(`panel hygiene: ${swept} template states clean (light + dark)`);
