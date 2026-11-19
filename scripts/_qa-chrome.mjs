// Shared harness for the Generate QA checks (check-generate-ui.mjs,
// check-generate-designs.mjs): a local static server with a pluggable /api/*
// stub, real headless Chrome over CDP (Node's built-in WebSocket, no npm deps),
// and a fake unexpired Supabase session. Same approach as check-panel-hygiene.
// Never calls a real API: /api/* is answered by the caller's stub, and any
// request to Supabase is blocked in the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find(p => fs.existsSync(p)) || '';
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

// api(req, url, body) -> { status, body, type?, delay? } | null (null = {"ok":true}).
// extra(url) -> { type, body } | null for generated files (e.g. /__qa/...).
export async function startServer({ api = null, extra = null } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
    const made = extra?.(url);
    if (made) { res.writeHead(200, { 'content-type': made.type, 'cache-control': 'no-store' }); res.end(made.body); return; }
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      let out = null;
      try { out = api ? await api(req, url, body) : null; } catch (error) { out = { status: 500, body: { error: String(error.message || error) } }; }
      out = out || { status: 200, body: { ok: true } };
      if (out.delay) await sleep(out.delay);
      res.writeHead(out.status || 200, { 'content-type': out.type || 'application/json' });
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
      return;
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://localhost:${server.address().port}` };
}

export async function startChrome(chromePath, { width = 1440, height = 1000 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-qa-'));
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', `--window-size=${width},${height}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method) listeners.forEach(fn => fn(m));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
    return r.result?.result?.value;
  };
  const close = () => {
    try { ws.close(); } catch {}
    try { chrome.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  return { send, evaluate, on: fn => listeners.push(fn), close };
}

// The page's own sign-in gate reads this; every API is stubbed, so it is never sent anywhere real.
export const FAKE_SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`;

// A plain sports figure, drawn as SVG (no photo rights involved). pose: 'stand'
// (full body, narrow), 'bust' (head and shoulders, wide), 'swing' (one arm
// raised above the head). cutout = transparent background; else a photo.
export function figureSvg({ pose = 'stand', cutout = true, colour = '#1D428A', w = 900, h = 1200 } = {}) {
  const skin = '#C68E62';
  const kit = colour;
  const P = {
    stand: `<circle cx="450" cy="190" r="92" fill="${skin}"/><rect x="398" y="150" width="104" height="40" rx="18" fill="#222"/><rect x="415" y="270" width="70" height="60" fill="${skin}"/>
      <path d="M260 340 Q450 290 640 340 L660 760 L240 760 Z" fill="${kit}"/><path d="M262 350 L190 700 L240 712 L300 420 Z" fill="${kit}"/><path d="M638 350 L710 700 L660 712 L600 420 Z" fill="${kit}"/>
      <path d="M270 760 L630 760 L600 1200 L480 1200 L450 900 L420 1200 L300 1200 Z" fill="#F2F2F2"/>`,
    bust: `<circle cx="450" cy="330" r="190" fill="${skin}"/><path d="M280 250 Q450 90 620 250 L620 300 L280 300 Z" fill="#222"/><rect x="380" y="500" width="140" height="110" fill="${skin}"/>
      <path d="M40 1200 Q60 640 450 600 Q840 640 860 1200 Z" fill="${kit}"/>`,
    swing: `<circle cx="430" cy="300" r="88" fill="${skin}"/><rect x="395" y="380" width="70" height="50" fill="${skin}"/>
      <path d="M520 420 L700 60 L740 80 L580 450 Z" fill="${kit}"/><path d="M700 60 L760 0 L780 20 L730 80 Z" fill="#888"/>
      <path d="M250 440 Q430 400 610 440 L630 820 L230 820 Z" fill="${kit}"/><path d="M252 450 L170 760 L220 772 L290 520 Z" fill="${kit}"/>
      <path d="M250 820 L610 820 L590 1200 L470 1200 L430 960 L390 1200 L270 1200 Z" fill="#F2F2F2"/>`,
  }[pose] || '';
  const bg = cutout ? '' : `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B4A5C"/><stop offset="0.6" stop-color="#7A8A99"/><stop offset="1" stop-color="#C9D2DA"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><rect y="${h * 0.72}" width="${w}" height="${h * 0.28}" fill="#4F7A3A"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice">${bg}${P}</svg>`;
}
