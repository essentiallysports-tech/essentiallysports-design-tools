// Headless Chrome over CDP with several page targets (one for the app, one for
// the encoder page). Node's built-in WebSocket, no npm deps. Same approach as
// scripts/_qa-chrome.mjs, but each target gets its own connection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find(p => fs.existsSync(p)) || '';
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method) listeners.forEach(fn => fn(m));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr, timeout = 600000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
    return r.result?.result?.value;
  };
  return { send, evaluate, on: fn => listeners.push(fn), close: () => { try { ws.close(); } catch {} } };
}

export async function launch({ width = 1440, height = 900, audio = false } = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found (set CHROME_PATH)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-explainer-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', 'about:blank'];
  if (!audio) args.splice(args.length - 1, 0, '--mute-audio');
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('Chrome did not start')), 20000);
  });
  const port = new URL(wsUrl).port;
  const conns = [];
  const page = async (url = 'about:blank') => {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const c = await connect(t.webSocketDebuggerUrl);
    conns.push(c);
    return c;
  };
  const close = () => {
    conns.forEach(c => c.close());
    try { proc.kill(); } catch {}
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 500);
  };
  return { page, close, proc };
}
