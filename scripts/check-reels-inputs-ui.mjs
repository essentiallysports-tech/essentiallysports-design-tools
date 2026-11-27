// Reels Studio inputs (2.0 lane C, updated for the v3 Create step): a real-browser check of the media tray,
// your own voiceover (upload, in-browser recording, fallbacks, nudge) and the
// caption files. Real headless Chrome over CDP with a FAKE microphone
// (--use-fake-device-for-media-stream), Node's built-in WebSocket, no npm deps.
// A local static server serves the repo; /api/* is stubbed (no AI, no network,
// no keys): 'voice-align' answers with the real server alignment over a canned
// transcript of the beats it is sent. The on-device recogniser's CDN is
// blocked, so its fallback (the even split) is exercised offline.
// Run: node scripts/check-reels-inputs-ui.mjs   (skips if Chrome isn't installed)
// Env: REELS_SHOTS=<dir> saves PNGs of the new UI at 1440 and 375, light and dark.
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
if (!CHROME) { console.log('reels inputs ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels inputs ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.REELS_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const server_ = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;
const voice_ = require(path.join(ROOT, 'netlify/functions/_reel-voice.js'));
const scenario = { ai: true, align: 'ok', seen: [] };
const CLIP = { url: 'https://x.com/NFL/status/1855000000000000001', handle: 'NFL', text: 'What a catch', variants: [{ url: '/design-request-banner.webm', width: 720, height: 1280 }] };
// What a recogniser would hear for these beats: every word, 300 ms each, a pause between scenes.
function heardFor(beats, durationMs) {
  const words = beats.flatMap((b, i) => String(b.vo).split(/\s+/).filter(Boolean).map((w, k) => ({ w: w.replace(/[,.']/g, ''), first: k === 0 && i > 0 })));
  const step = Math.max(120, Math.floor((durationMs - 400) / Math.max(1, words.length + beats.length)));
  let at = 150;
  return words.map(x => { if (x.first) at += step; const word = { w: x.w, s: at, e: at + Math.round(step * 0.8) }; at += step; return word; });
}
async function reelApi(body) {
  const mode = body.mode;
  scenario.seen.push(mode === 'event' ? `event:${body.type}:${JSON.stringify(body.payload)}` : mode);
  if (mode === 'config') return [200, { ok: true, ai: scenario.ai, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'Voice is not set up here.' }, music: { ready: false }, formats: [], dataFormats: ['gameswing', 'replay', 'archive'], formatModes: {}, prices: {}, styles: [], aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: false } }];
  if (mode === 'trends') return [200, { ok: true, hours: 48, stale: false, updatedAt: new Date().toISOString(), items: [] }];
  if (mode === 'plan') { const r = await server_.plan(body, { email: 'qa@essentiallysports.com' }, { off: true }); return [r.ok ? 200 : (r.status || 502), r]; }
  if (mode === 'voice-align') {
    if (scenario.align === 'free') return [200, { ok: true, skipped: true, mode: 'free', reason: 'user-limit' }];
    if (scenario.align === 'fail') return [502, { ok: false, error: 'The recording could not be transcribed right now.' }];
    const check = voice_.checkTake(Buffer.from(String(body.audio || ''), 'base64'));
    if (!check.ok) return [check.reason === 'too-long' ? 413 : 400, { ok: false, reason: check.reason, error: check.error }];
    const beats = Array.isArray(body.beats) ? body.beats : [];
    if (!beats.length) {
      const said = 'Josh Allen did it again on Sunday night. The Bills are now ten and two. Nobody saw this coming in September.';
      const words = heardFor([{ vo: said }], check.durationMs);
      return [200, { ok: true, durationMs: check.durationMs, beats: [], match: 0, transcript: said, words, provider: 'groq', model: 'stub', cost: 0 }];
    }
    const aligned = voice_.alignBeats(beats, heardFor(beats, check.durationMs), check.durationMs);
    return [200, { ok: true, durationMs: check.durationMs, beats: aligned.beats, match: aligned.match, transcript: beats.map(b => b.vo).join(' '), provider: 'groq', model: 'stub', cost: 0 }];
  }
  if (['event', 'project-save', 'projects'].includes(mode)) return [200, { ok: true, cloud: true, projects: [] }];
  return [503, { ok: false, reason: 'off', error: 'AI is not available right now.' }];
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const PHOTOS = ['/how-step-choose.webp', '/how-step-content.webp', '/how-step-export.webp'];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, data) => { if (data == null) { res.writeHead(status); res.end(); return; } res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname === '/api/reel-maker') { const [s, d] = await reelApi(await readBody(req)); send(s, d); return; }
  if (url.pathname === '/api/video-ads') { const b = await readBody(req); scenario.seen.push(`video-ads:${b.mode}`); send(200, b.mode === 'clip' ? { ok: true, ...CLIP, url: b.url } : { ok: true, clips: [], cost: 0 }); return; }
  if (url.pathname === '/api/es-image-search') { send(200, { source: 'es', results: PHOTOS.map((p, i) => ({ id: `p${i}`, proxyUrl: p, title: `Photo ${i + 1}`, credit: 'ES', width: 1600, height: 900 })) }); return; }
  if (url.pathname === '/api/ai-status') { send(200, { ok: true, mode: 'ai', reason: null }); return; }
  if (url.pathname.startsWith('/api/')) { send(200, { ok: true }); return; }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-reels-inputs-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
let consoleErrors = [];
const IGNORE_CONSOLE = [/supabase\.co\/rest\/v1\//, /fonts\.(googleapis|gstatic)/, /cdn\.jsdelivr/, /unpkg\.com/, /favicon/, /huggingface/];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = `${m.params.entry.text} ${m.params.entry.url || ''}`; if (!IGNORE_CONSOLE.some(r => r.test(t)) && !(/Failed to load resource/.test(t) && /\/api\//.test(t))) consoleErrors.push('log: ' + t.slice(0, 200)); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
// No production writes, and the on-device recogniser's model CDN is blocked (its fallback runs offline).
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*', '*://cdn.jsdelivr.net/npm/@huggingface/*', '*://unpkg.com/@huggingface/*', '*://huggingface.co/*'] });
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
async function setViewport(w) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 812 : 1000, deviceScaleFactor: 1, mobile: w < 768 }); }
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`;
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
await evaluate(SESSION);
async function load({ keep = false } = {}) {
  if (!keep) await evaluate(`(async () => { try { for (const k of Object.keys(localStorage)) if (/reel/i.test(k)) localStorage.removeItem(k); sessionStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('frameup-reels'); q.onsuccess = q.onerror = q.onblocked = r; }); } catch {} return 1; })()`);
  await evaluate(`(sessionStorage.setItem('frameup.tours.offered', '1'), 1)`);
  await send('Page.navigate', { url: `${base}/reel-maker.html` });
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    const ok = await evaluate(`Boolean(window.ReelMakerCtx && window.ReelMakerCtx.modules.tray && document.querySelector('#rm-pane-topic')) && document.documentElement.style.visibility !== 'hidden' && !/login/.test(location.pathname)`).catch(() => false);
    if (ok) break;
  }
  if (/login/.test(await evaluate('location.pathname'))) throw new Error('sign-in gate: reel-maker.html went to login');
  await evaluate(`(() => { const s = document.createElement('style'); s.id='qa-calm'; s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 1; })()`);
  await evaluate(HELPERS);
  await sleep(500);
  consoleErrors = [];
}
const AUDIT = fs.readFileSync(path.join(ROOT, 'scripts/lib/reels-ui-audit.js'), 'utf8');
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const waitFor = async (expr, ms = 15000, what = expr) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(150); } throw new Error(`timed out waiting for ${what}`); };
const typeInto = (sel, text) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

// In-page helpers: generated files (a PNG, a WAV of spoken-like bursts, the repo's sample WebM).
const HELPERS = `(() => {
  window.qa = {
    ctx: () => window.ReelMakerCtx,
    png(name, color = '#0A7DFA') { return new Promise(r => { const c = document.createElement('canvas'); c.width = 320; c.height = 480; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 480); c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png'); }); },
    async webm(name) { const b = await (await fetch('/design-request-banner.webm')).blob(); return new File([b], name, { type: 'video/webm' }); },
    wav(name, seconds, rate = 44100) {
      const n = Math.round(seconds * rate); const bytes = new Uint8Array(44 + n * 2); const v = new DataView(bytes.buffer);
      const t = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      t(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); t(8, 'WAVE'); t(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) { const s = i / rate; const on = (s % 0.4) < 0.3; v.setInt16(44 + i * 2, on ? Math.sin(s * 2 * Math.PI * (180 + 40 * Math.floor(s))) * 12000 : 0, true); }
      return new File([bytes], name, { type: 'audio/wav' });
    },
    toasts: () => [...document.querySelectorAll('#rm-toasts .rm-toast')].map(t => t.textContent.trim()),
    clearToasts: () => { document.querySelectorAll('#rm-toasts .rm-toast').forEach(t => t.remove()); return 1; },
    drop(sel, files) { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); const el = document.querySelector(sel); ['dragenter', 'dragover', 'drop'].forEach(type => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))); return 1; },
    used: () => { const s = window.ReelMakerCtx.state; return Object.fromEntries(Object.entries(s.photos).map(([b, ids]) => [b, ids.map(id => ({ id, kind: s.assets[id]?.kind, local: Boolean(s.assets[id]?.local), src: s.visualSrc[b] }))])); },
  };
  return 1;
})()`;

const failures = [];
const notes = [];
let stepN = 0;
async function step(name, fn) {
  stepN += 1;
  try { await fn(); console.log(`ok   ${name}`); } catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
  const errs = consoleErrors.splice(0);
  if (errs.length) { failures.push(`${name}: console: ${errs.join(' | ')}`); console.log(`FAIL ${name}: console: ${errs.join(' | ')}`); }
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const SCRIPT = 'The Cubs lost on Sunday night. But one bar in Chicago got *paid* in full. Kalshi says 1 in 2,500 bets was insurance. Josh Allen fans are still arguing about it.';
// Reels Studio v3: one prompt card; "Use my exact words" keeps the script word for word.
const scriptMode = () => evaluate(`(() => { const s = document.querySelector('#rm-script-mode'); if (s && !s.checked) s.click(); return Boolean(s); })()`);
async function makeScriptReel() {
  await scriptMode();
  await typeInto('#rm-prompt', SCRIPT);
  await click('#rm-make');
  await waitFor(`!document.querySelector('#rm-pane-edit').hidden && Boolean(window.ReelMakerCtx.state.timeline)`, 30000, 'Review step');
  await sleep(400);
}
async function audit(name, roots) {
  for (const theme of ['light', 'dark']) {
    await evaluate(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); window.FrameUpTheme?.apply?.(${JSON.stringify(theme)}); return 1; })()`).catch(() => {});
    await sleep(150);
    const r = await evaluate(`(${AUDIT})({ roots: ${JSON.stringify(roots)}, warns: false, ignore: ['.es-skeleton', '.es-sr-only', 'audio'], keyActions: [] })`);
    const scroll = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    if (scroll > 1) r.issues.push(`horizontal page scroll (${scroll}px): ${await evaluate(`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 4).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' ' + Math.round(e.getBoundingClientRect().right)).join(', ')`)}`);
    if (r.issues.length) failures.push(`${name} [${theme}]: ${r.issues.join(' | ')}`);
    if (SHOTS) { const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(SHOTS, `${name}-${theme}.png`), Buffer.from(shot.result.data, 'base64')); }
  }
  await evaluate(`(document.documentElement.setAttribute('data-theme', 'light'), window.FrameUpTheme?.apply?.('light'), 1)`);
}

try {
  // ── 1. Desktop: tray, captions, voice upload, recording, persistence ──
  await setViewport(1440);
  await load();
  await step('modules are published on the page context', async () => {
    const m = await evaluate(`(() => { const m = window.ReelMakerCtx.modules; return { tray: ['addFiles', 'open', 'mount'].every(k => typeof m.tray?.[k] === 'function'), voice: ['open', 'mount'].every(k => typeof m.voiceInput?.[k] === 'function'), captions: ['srt', 'vtt', 'transcript', 'download'].every(k => typeof m.captions?.[k] === 'function') }; })()`);
    expect(m.tray && m.voice && m.captions, JSON.stringify(m));
    expect(await evaluate(`Boolean(document.querySelector('#ri-tray') && document.querySelector('#ri-voice-panel') && document.querySelector('#ri-captions') && document.querySelector('#ri-script-voice'))`), 'a temporary entry point is missing');
  });
  await step('files added before the reel exists wait in the tray', async () => {
    await evaluate(`(async () => { await qa.ctx().modules.tray.addFiles([await qa.png('wrigleyville-bar.png')], { via: 'picker' }); return 1; })()`);
    const t = await evaluate(`qa.toasts().join(' | ')`);
    expect(/1 file ready\. It goes onto your scenes when the reel is made/.test(t), `toast: ${t}`);
    expect(await evaluate(`document.querySelectorAll('#ri-tray [data-ri-item]').length`) === 1, 'tray item missing');
  });
  await audit('1440-tray-waiting', ['#ri-tray']);
  await step('make a script reel; the waiting file lands on a scene', async () => {
    await makeScriptReel();
    await waitFor(`Object.values(qa.used()).flat().some(a => a.local)`, 5000, 'waiting file assigned');
  });
  await step('multi-file add: the video goes to the hook, a matching name to its scene, with Undo', async () => {
    await evaluate(`qa.clearToasts()`);
    const out = await evaluate(`(async () => {
      const s = qa.ctx().state;
      // Start clean so the assignment is the tray's own.
      qa.ctx().modules.tray.items().forEach(i => qa.ctx().modules.tray.remove(i.id));
      const files = [await qa.png('stadium.png', '#1BC47D'), await qa.webm('highlight.webm'), await qa.png('notes.png', '#E8322B')];
      const bad = new File([new Uint8Array(10)], 'brief.pdf', { type: 'application/pdf' });
      const r = await qa.ctx().modules.tray.addFiles([...files, bad], { via: 'picker' });
      const hook = s.plan.beats[0].id;
      return { added: r.added.length, skipped: r.skipped, hook: qa.used()[hook], toasts: qa.toasts(), items: qa.ctx().modules.tray.items() };
    })()`);
    expect(out.added === 3, `added ${out.added}`);
    expect(out.skipped.length === 1 && /brief\.pdf is not a photo or a video/.test(out.skipped[0]), `skipped: ${out.skipped}`);
    expect(out.hook && out.hook[0].kind === 'clip' && out.hook[0].src === 'upload-clip', `hook: ${JSON.stringify(out.hook)}`);
    expect(out.toasts.some(t => /^Added 3 files to scenes? .*Undo$/.test(t)), `toasts: ${out.toasts.join(' | ')}`);
    expect(out.toasts.some(t => /brief\.pdf is not a photo or a video/.test(t)), 'no error toast for the PDF');
    notes.push(`auto-assign: ${out.items.map(i => `${i.name}->${i.beats.join(',') || 'tray'}`).join('; ')}`);
  });
  await step('Undo puts the scenes back and keeps the files in the tray', async () => {
    const before = await evaluate(`Object.values(qa.used()).flat().filter(a => a.local).length`);
    await evaluate(`(document.querySelector('#rm-toasts .es-toast-action').click(), 1)`);
    await sleep(300);
    const after = await evaluate(`({ used: Object.values(qa.used()).flat().filter(a => a.local).length, items: qa.ctx().modules.tray.items().length })`);
    expect(before >= 2 && after.used === 0 && after.items === 3, `before ${before}, after ${JSON.stringify(after)}`);
  });
  await step('keyboard move: the tray\'s scene select puts a file on a scene', async () => {
    const r = await evaluate(`(async () => {
      const sel = document.querySelector('#ri-tray [data-ri-move]');
      const opt = [...sel.options].find(o => o.value); sel.focus(); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return { beat: opt.value, on: qa.used()[opt.value], labelled: Boolean(document.querySelector('label[for="' + sel.id + '"]')), focus: document.activeElement?.id === sel.id };
    })()`);
    expect(r.on && r.on[0].local, `not placed: ${JSON.stringify(r)}`);
    expect(r.labelled, 'select has no label');
    expect(r.focus, 'focus was lost after the move');
  });
  await step('drop on a scene chip puts the file on that scene; the overlay shows and hides', async () => {
    const r = await evaluate(`(async () => {
      const s = qa.ctx().state; const target = s.plan.beats[0].id;
      const dt = new DataTransfer(); dt.items.add(await qa.png('dropped.png', '#FFC52F'));
      const chip = document.querySelector('#rm-beats [data-ri-beat="' + target + '"]');
      chip.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const shown = !document.querySelector('.ri-drop').hidden;
      chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const marked = chip.classList.contains('ri-drop-on');
      chip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 600));
      const id = (s.photos[target] || [])[0];
      return { shown, marked, hidden: document.querySelector('.ri-drop').hidden, name: s.assets[id]?.name, src: s.visualSrc[target] };
    })()`);
    expect(r.shown && r.marked && r.hidden, `overlay: ${JSON.stringify(r)}`);
    expect(r.name === 'dropped.png' && r.src === 'upload', `drop target: ${JSON.stringify(r)}`);
  });
  await step('the per-beat Upload button is one caller of the tray', async () => {
    const r = await evaluate(`(async () => {
      const s = qa.ctx().state; const target = s.plan.beats[0].id;
      qa.ctx().selectBeat(target);
      await qa.ctx().visualAction(target, 'upload').catch(() => {});
      const input = document.querySelector('#rm-visual-file'); const dt = new DataTransfer(); dt.items.add(await qa.png('per-beat.png', '#121212'));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      const id = (s.photos[target] || [])[0];
      return { name: s.assets[id]?.name, local: s.assets[id]?.local, inTray: qa.ctx().modules.tray.items().some(i => i.name === 'per-beat.png') };
    })()`);
    expect(r.name === 'per-beat.png' && r.local && r.inTray, JSON.stringify(r));
  });
  await step('paste: an image file is added; an X post link uses the rights-checked clip path', async () => {
    const r = await evaluate(`(async () => {
      const s = qa.ctx().state; const n0 = qa.ctx().modules.tray.items().length;
      const dt = new DataTransfer(); dt.items.add(await qa.png('image.png', '#0A7DFA'));
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      await new Promise(r => setTimeout(r, 700));
      const n1 = qa.ctx().modules.tray.items().length;
      const dt2 = new DataTransfer(); dt2.setData('text/plain', 'https://x.com/NFL/status/1855000000000000001?s=20');
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt2 }));
      await new Promise(r => setTimeout(r, 2500));
      const x = Object.entries(s.visualSrc).find(([, v]) => v === 'x-clip');
      const asset = x ? s.assets[(s.photos[x[0]] || [])[0]] : null;
      // A link pasted into a text field is just text.
      const ta = document.querySelector('#rm-extra-source'); const dt3 = new DataTransfer(); dt3.setData('text/plain', 'https://x.com/NFL/status/1855000000000000002');
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt3 }); ta.dispatchEvent(ev);
      return { n0, n1, x: Boolean(x), rights: asset?.rights?.source || '', post: asset?.post || '', fieldLeftAlone: !ev.defaultPrevented, pastedName: qa.ctx().modules.tray.items().slice(-1)[0]?.name };
    })()`);
    expect(r.n1 === r.n0 + 1 && /^pasted-/.test(r.pastedName), `pasted image: ${JSON.stringify(r)}`);
    expect(r.x && /Official X post/.test(r.rights) && /x\.com\/NFL\/status/.test(r.post), `x link: ${JSON.stringify(r)}`);
    expect(r.fieldLeftAlone, 'a paste into a text field was hijacked');
    expect(scenario.seen.includes('video-ads:clip'), 'the clip endpoint was not called');
  });
  await audit('1440-tray-filled', ['#ri-tray']);

  await step('caption files: SRT, VTT and transcript match the burned-in cards; the buttons download', async () => {
    await click('#rm-next');
    await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'Export step');
    const r = await evaluate(`(() => {
      const c = qa.ctx().modules.captions; const tl = qa.ctx().state.timeline; const cards = tl.tracks.captions.cards;
      const srt = c.srt(); const vtt = c.vtt(); const tx = c.transcript();
      qa.clearToasts();
      document.querySelector('#ri-captions [data-ri-cap="srt"]').click();
      return { cards: cards.length, blocks: srt.trim().split('\\n\\n').length, first: srt.split('\\n')[1], firstCard: cards[0].s, vtt: vtt.startsWith('WEBVTT'), star: /\\*/.test(srt + vtt + tx), tx, toast: qa.toasts().join(' | '), buttons: document.querySelectorAll('#ri-captions button:not(:disabled)').length };
    })()`);
    expect(r.cards > 5 && r.blocks === r.cards, `cues ${r.blocks} vs cards ${r.cards}`);
    expect(r.vtt && !r.star, 'VTT header or asterisks');
    expect(r.tx.replace(/\s+/g, ' ').trim() === SCRIPT.replace(/\*/g, ''), `transcript: ${r.tx}`);
    expect(/Saved es-reel-.*-captions\.srt/.test(r.toast), `toast: ${r.toast}`);
    expect(r.buttons === 3, 'three caption buttons');
    await sleep(300);
    expect(scenario.seen.some(s => /^event:captions_export:.*"kind":"srt"/.test(s)), 'captions_export was not logged');
  });
  await audit('1440-export-captions', ['#ri-captions']);
  await click('#rm-back');
  await waitFor(`!document.querySelector('#rm-pane-edit').hidden`, 4000, 'Review step');

  await step('voice upload: a generated WAV is aligned by the server and cut per scene from the original audio', async () => {
    const r = await evaluate(`(async () => {
      const ctx = qa.ctx(); const s = ctx.state; qa.clearToasts();
      const out = await ctx.modules.voiceInput.useFile(qa.wav('my-voiceover.wav', 9));
      await new Promise(r => setTimeout(r, 300));
      const spoken = s.plan.beats.filter(b => (b.vo || '').trim());
      const vo = s.timeline.tracks.audio.filter(a => a.kind === 'vo');
      const mix = await ctx.renderMix();
      let peak = 0; if (mix) { const d = mix.getChannelData(0); for (let i = 0; i < d.length; i += 97) peak = Math.max(peak, Math.abs(d[i])); }
      return { out, spoken: spoken.length, own: spoken.filter(b => s.voice[b.id]?.own).length, rate: s.buffers['vo:' + spoken[0].id]?.sampleRate, total: spoken.reduce((a, b) => a + (s.buffers['vo:' + b.id]?.duration || 0), 0),
        vo: vo.length, rights: s.assets['vo:' + spoken[0].id]?.rights?.source, estimate: s.timeline.timing?.estimate, words: s.timeline.tracks.captions.words.map(w => w.w).join(' '), peak, mixSeconds: mix ? mix.duration : 0, tl: s.timeline.durationMs / 1000,
        badge: document.querySelector('#rm-voice-badge').textContent, panel: document.querySelector('#ri-voice-panel').textContent.replace(/\\s+/g, ' '), toast: qa.toasts().join(' | '), lint: s.lint.issues.some(i => i.id === 'voice') };
    })()`);
    expect(r.out.ok && r.out.timing === 'ai', `result: ${JSON.stringify(r.out)}`);
    expect(r.own === r.spoken && r.vo === r.spoken, `voiced ${r.own}/${r.spoken}, audio clips ${r.vo}`);
    expect(r.rate === 48000, `slices are not full quality (rate ${r.rate}; they must not follow the 16 kHz copy sent for timing, or the machine's speaker rate)`);
    expect(r.total > 4 && r.total <= 9.01, `cut audio totals ${r.total}s of a 9 s take`);
    expect(r.rights === 'Your recording', `rights: ${r.rights}`);
    expect(r.estimate === false, 'timeline still says times are estimates');
    expect(r.words === SCRIPT.replace(/\*/g, ''), `captions are not the script: ${r.words}`);
    expect(r.peak > 0.05 && Math.abs(r.mixSeconds - r.tl) < 0.1, `mix: peak ${r.peak}, ${r.mixSeconds}s vs ${r.tl}s`);
    expect(r.badge === 'Your recording', `badge: ${r.badge}`);
    expect(/Your recording.*timed to your words.*my-voiceover\.wav/.test(r.panel), `panel: ${r.panel}`);
    expect(/Your voiceover is in\. Scenes and captions follow your voice/.test(r.toast), `toast: ${r.toast}`);
    expect(!r.lint, 'lint still says "captions only, no voiceover"');
    await sleep(300);
    expect(scenario.seen.some(s => /^event:voice_upload:.*"via":"upload".*"timing":"ai"/.test(s)), 'voice_upload was not logged');
    const ev = scenario.seen.filter(s => s.startsWith('event:voice_upload') || s.startsWith('event:media_add') || s.startsWith('event:captions_export')).join(' ');
    expect(!/Cubs|Kalshi|Josh/.test(ev), 'an event payload carries script text');
    notes.push(`voice upload: 9 s take -> ${r.vo} scenes, ${r.total.toFixed(2)} s of audio used, reel ${r.tl.toFixed(1)} s`);
  });
  await step('nudge start: one scene moves by 0.1 s, focus stays on the button', async () => {
    await evaluate(`(() => { const d = document.querySelector('#rm-voice'); d.open = true; const n = document.querySelector('#ri-voice-panel .ri-nudge'); n.open = true; return 1; })()`);
    const r = await evaluate(`(async () => {
      const s = qa.ctx().state; const id = s.plan.beats[1].id; const before = s.voice[id].durationMs; const w0 = s.voice[id].words[0].s;
      const btn = document.querySelector('#ri-voice-panel [data-ri-nudge="' + id + '"][data-d="1"]'); btn.focus(); btn.click();
      await new Promise(r => setTimeout(r, 200));
      const a = document.activeElement;
      return { before, after: s.voice[id].durationMs, nudge: s.voiceOwn.windows[id].nudgeMs, val: document.querySelector('#ri-voice-panel [data-ri-nudge="' + id + '"]').parentElement.querySelector('output').textContent, focus: a?.dataset?.riNudge === id && a?.dataset?.d === '1', label: btn.getAttribute('aria-label'), selected: s.selected === id };
    })()`);
    expect(r.nudge === 100 && r.after === r.before - 100, `nudge: ${JSON.stringify(r)}`);
    expect(r.val === '+0.1 s' && r.focus && /^Start scene 2 later$/.test(r.label) && r.selected, `ui: ${JSON.stringify(r)}`);
  });
  await audit('1440-voice-attached', ['#ri-voice-panel']);
  await step('an AI voice is never laid over your own recording', async () => {
    const r = await evaluate(`(async () => { const c = qa.ctx(); const before = scenario => 0; const res = await c.makeVoice(); await c.ensureVoice(); return res; })()`);
    expect(r.made === 0 && !scenario.seen.includes('voice'), 'the AI voice ran');
  });

  await step('persistence: reopening the reel brings back the uploads and the voiceover from this browser', async () => {
    await evaluate(`(async () => { const c = qa.ctx(); const s = c.state; const clip = c.modules.tray.items().find(i => i.kind === 'video'); const img = c.modules.tray.items().find(i => i.kind === 'image'); const free = s.plan.beats.filter((b, i) => i > 0 && c.ES.takesMedia(b)); if (clip && free[0]) c.modules.tray.moveTo(clip.id, free[0].id); if (img && free[1]) c.modules.tray.moveTo(img.id, free[1].id); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
    const before = await evaluate(`(async () => { const s = qa.ctx().state; await new Promise(r => setTimeout(r, 1200)); return { id: s.projectId, local: Object.values(qa.used()).flat().filter(a => a.local).map(a => a.id).sort(), store: (await qa.ctx().modules.tray.store.projects()).map(p => [p.projectId, p.keys.length]) }; })()`);
    expect(before.local.length >= 2, `nothing to persist: ${JSON.stringify(before)}`);
    await load({ keep: true });
    await waitFor(`Boolean(document.querySelector('#rm-recent-list [data-project]'))`, 5000, 'recent list');
    await click('#rm-recent-list [data-project]');
    await waitFor(`Boolean(window.ReelMakerCtx.state.timeline) && window.ReelMakerCtx.modules.voiceInput.active()`, 15000, 'restored reel with its voiceover');
    await sleep(800);
    const after = await evaluate(`(() => { const s = qa.ctx().state; const local = Object.values(qa.used()).flat().filter(a => a.local).map(a => a.id).sort(); return { id: s.projectId, local, drawn: local.every(id => s.images[id] || s.videos[id]), items: qa.ctx().modules.tray.items().length, own: s.plan.beats.filter(b => s.voice[b.id]?.own).length, nudge: Object.values(s.voiceOwn.windows).map(w => w.nudgeMs || 0).join(','), missing: qa.ctx().modules.tray.missing().length, vo: s.timeline.tracks.audio.filter(a => a.kind === 'vo').length }; })()`);
    expect(after.id === before.id && JSON.stringify(after.local) === JSON.stringify(before.local), `uploads: ${JSON.stringify(before.local)} -> ${JSON.stringify(after.local)}`);
    expect(after.drawn && after.missing === 0, `not rehydrated: ${JSON.stringify(after)}`);
    expect(await evaluate(`Object.values(qa.used()).flat().some(a => a.local && a.kind === 'clip' && Boolean(qa.ctx().state.videos[a.id]))`), 'the uploaded clip did not come back as a video');
    expect(after.own >= 3 && after.vo === after.own && /100/.test(after.nudge), `voiceover: ${JSON.stringify(after)}`);
    notes.push(`persistence: ${after.local.length} uploads + voiceover restored after reload (IndexedDB v2)`);
  });
  await step('a file that is not on this device: "Re-add" prompt, then it goes back on its scene', async () => {
    const lost = await evaluate(`(async () => { const s = qa.ctx().state; const a = Object.values(qa.used()).flat().find(x => x.local && x.kind === 'upload'); const beat = Object.keys(s.photos).find(b => s.photos[b].includes(a.id)); const name = s.assets[a.id].name; await qa.ctx().modules.tray.store.remove(s.projectId, a.id); await qa.ctx().modules.tray.store.remove(s.projectId, 'voice'); await new Promise(r => setTimeout(r, 900)); return { id: a.id, beat, name }; })()`);
    await load({ keep: true });
    await click('#rm-recent-list [data-project]');
    await waitFor(`Boolean(window.ReelMakerCtx.state.timeline) && window.ReelMakerCtx.modules.tray.missing().length === 1`, 15000, 'missing file noticed');
    await sleep(600);
    const r = await evaluate(`(() => { const s = qa.ctx().state; return { banner: document.querySelector('#ri-tray .ri-tray__missing')?.textContent.replace(/\\s+/g, ' ') || '', toasts: qa.toasts().join(' | '), stillPicked: (s.photos[${JSON.stringify(lost.beat)}] || []).includes(${JSON.stringify(lost.id)}), voicePanel: document.querySelector('#ri-voice-panel').textContent.replace(/\\s+/g, ' '), pending: qa.ctx().modules.voiceInput.pending(), saved: JSON.stringify(qa.ctx().snapshot().timeline.mediaMissing || []) }; })()`);
    expect(/1 file from this reel is not on this device/.test(r.banner) && /Re-add 1 file/.test(r.banner), `banner: ${r.banner}`);
    expect(/Re-add 1 file/.test(r.toasts), `toast: ${r.toasts}`);
    expect(!r.stillPicked, 'the missing file is still on its scene');
    expect(/voiceover is not on this device/.test(r.voicePanel) && r.pending, `voice panel: ${r.voicePanel}`);
    expect(r.saved.includes(lost.id), 'the missing file is not kept in the saved project');
    await audit('1440-missing', ['#ri-tray', '#ri-voice-panel']);
    const back = await evaluate(`(async () => { const s = qa.ctx().state; const f = await qa.png(${JSON.stringify(lost.name)}); await qa.ctx().modules.tray.addFiles([f], { via: 'picker' }); await new Promise(r => setTimeout(r, 400)); return { on: (s.photos[${JSON.stringify(lost.beat)}] || [])[0], missing: qa.ctx().modules.tray.missing().length }; })()`);
    expect(back.on === lost.id && back.missing === 0, `re-add: ${JSON.stringify(back)}`);
  });

  await step('a different reel keeps its own tray: another reel\'s files are not put on it', async () => {
    const r = await evaluate(`(async () => {
      const c = qa.ctx(); const s = c.state; const mine = c.modules.tray.items().length;
      const other = JSON.parse(JSON.stringify(c.snapshot())); other.id = crypto.randomUUID(); other.title = 'Another reel';
      Object.keys(other.timeline.assets).forEach(id => { if (other.timeline.assets[id].local) delete other.timeline.assets[id]; });
      other.timeline.photos = {}; other.timeline.visualSrc = {}; delete other.timeline.voiceOwn; delete other.timeline.mediaMissing;
      const first = JSON.parse(JSON.stringify(c.snapshot()));
      await c.restore(other); await new Promise(r => setTimeout(r, 900));
      const there = { items: c.modules.tray.items().length, own: Object.values(qa.used()).flat().filter(a => a.local).length, voice: c.modules.voiceInput.active() || c.modules.voiceInput.pending() };
      await c.restore(first); await new Promise(r => setTimeout(r, 1200));
      return { mine, there, back: c.modules.tray.items().length, backOwn: Object.values(qa.used()).flat().filter(a => a.local).length };
    })()`);
    expect(r.mine >= 2 && r.there.items === 0 && r.there.own === 0 && !r.there.voice, `the other reel: ${JSON.stringify(r)}`);
    expect(r.back >= 2 && r.backOwn >= 2, `coming back: ${JSON.stringify(r)}`);
  });

  // ── 2. Recording with the fake microphone ──
  await step('record: count-in, level meter, 90 s cap shown, stop, listen back, use the take', async () => {
    await evaluate(`(qa.ctx().modules.voiceInput.remove({ quiet: true }), qa.clearToasts(), 1)`);
    await evaluate(`(qa.ctx().modules.voiceInput.open(), 1)`);
    await waitFor(`document.querySelector('#ri-voice').open`, 2000, 'dialog');
    const idle = await evaluate(`(() => { const d = document.querySelector('#ri-voice'); return { prompter: d.querySelectorAll('.ri-prompter li').length, primary: d.querySelectorAll('.es-btn--primary').length, focus: document.activeElement?.hasAttribute('data-ri-record'), hint: d.textContent.includes('Up to 90 seconds') }; })()`);
    expect(idle.prompter >= 3 && idle.primary === 1 && idle.focus && idle.hint, `idle: ${JSON.stringify(idle)}`);
    await audit('1440-voice-dialog', ['#rm-toasts']); // the audit adds every open dialog itself
    await click('#ri-voice [data-ri-record]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'countin'`, 4000, 'count-in');
    const count = await evaluate(`document.querySelector('#ri-voice [data-ri-count]').textContent`);
    expect(['3', '2'].includes(count), `count-in shows "${count}"`);
    expect(await evaluate(`document.querySelector('#ri-voice [data-ri-stop]').disabled`), 'Stop is live during the count-in');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'recording'`, 6000, 'recording');
    await sleep(2600);
    const live = await evaluate(`(() => { const d = document.querySelector('#ri-voice'); const m = d.querySelector('[data-ri-meter]'); return { time: d.querySelector('[data-ri-time]').textContent, level: Number(m.getAttribute('aria-valuenow')), role: m.getAttribute('role'), status: d.querySelector('[data-ri-status]').textContent, of: d.querySelector('.ri-rec__of').textContent }; })()`);
    expect(/^0:0[23]$/.test(live.time), `timer: ${live.time}`);
    expect(live.role === 'meter' && live.level > 0, `meter: ${JSON.stringify(live)}`);
    expect(/of 1:30/.test(live.of), `cap: ${live.of}`);
    if (SHOTS) { const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, '1440-voice-recording-light.png'), Buffer.from(shot.result.data, 'base64')); }
    await click('#ri-voice [data-ri-stop]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'review'`, 5000, 'review');
    const review = await evaluate(`(() => { const d = document.querySelector('#ri-voice'); return { audio: Boolean(d.querySelector('audio[src^="blob:"]')), primary: d.querySelectorAll('.es-btn--primary').length, retake: Boolean(d.querySelector('[data-ri-record]')), focus: document.activeElement?.hasAttribute('data-ri-use') }; })()`);
    expect(review.audio && review.primary === 1 && review.retake && review.focus, `review: ${JSON.stringify(review)}`);
    await audit('1440-voice-review', ['#rm-toasts']); // the audit adds every open dialog itself
    await click('#ri-voice [data-ri-use]');
    await waitFor(`!document.querySelector('#ri-voice').open && window.ReelMakerCtx.modules.voiceInput.active()`, 30000, 'take applied');
    const r = await evaluate(`(() => { const s = qa.ctx().state; return { via: s.voiceOwn.via, seconds: s.voiceOwn.seconds, own: s.plan.beats.filter(b => s.voice[b.id]?.own).length, tracks: 0 }; })()`);
    expect(r.via === 'record' && r.seconds > 1.5 && r.seconds < 5 && r.own >= 3, `take: ${JSON.stringify(r)}`);
    expect(scenario.seen.some(s => /^event:voice_upload:.*"via":"record"/.test(s)), 'the recording was not logged');
    notes.push(`recording (fake microphone): ${r.seconds}s take, MediaRecorder -> decode -> 16 kHz WAV -> align -> ${r.own} scenes`);
  });
  await step('re-take and cancel release the microphone', async () => {
    await evaluate(`(qa.ctx().modules.voiceInput.open(), 1)`);
    await click('#ri-voice [data-ri-record]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'recording'`, 8000, 'recording');
    await sleep(700);
    await click('#ri-voice [data-ri-stop]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'review'`, 5000, 'review');
    await click('#ri-voice [data-ri-record]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'countin'`, 4000, 're-take count-in');
    await click('#ri-voice [data-ri-cancel]');
    await waitFor(`document.querySelector('#ri-voice').dataset.view === 'idle'`, 4000, 'back to idle');
    await click('#ri-voice [data-ri-close]');
    await waitFor(`!document.querySelector('#ri-voice').open`, 2000, 'closed');
    expect(await evaluate(`window.ReelMakerCtx.modules.voiceInput.active()`), 'cancelling a re-take dropped the voiceover that was already on');
  });

  // ── 3. Limits and fallbacks ──
  await step('the 90 s cap: a longer file is refused with a clear message, nothing is sent', async () => {
    const n = scenario.seen.filter(s => s === 'voice-align').length;
    const r = await evaluate(`(async () => await qa.ctx().modules.voiceInput.useFile(qa.wav('long.wav', 96, 8000)))()`);
    expect(!r.ok && r.reason === 'too-long' && /1:36 long.*up to 90 seconds/.test(r.error), JSON.stringify(r));
    expect(scenario.seen.filter(s => s === 'voice-align').length === n, 'the long take was sent');
    const bad = await evaluate(`(async () => await qa.ctx().modules.voiceInput.useFile(new File([new Uint8Array(2000)], 'clip.mp4', { type: 'video/mp4' })))()`);
    expect(!bad.ok && /MP3, M4A, WAV or WebM/.test(bad.error), JSON.stringify(bad));
    const junk = await evaluate(`(async () => await qa.ctx().modules.voiceInput.useFile(new File([new Uint8Array(2000)], 'broken.mp3', { type: 'audio/mpeg' })))()`);
    expect(!junk.ok && /could not be read as audio/.test(junk.error), JSON.stringify(junk));
  });
  await step('a full 90 s take goes up in one request under the body cap', async () => {
    const r = await evaluate(`(async () => { const t0 = performance.now(); const out = await qa.ctx().modules.voiceInput.useFile(qa.wav('full.wav', 90, 22050)); return { out, ms: Math.round(performance.now() - t0), seconds: qa.ctx().state.voiceOwn?.seconds }; })()`);
    expect(r.out.ok && r.seconds === 90, JSON.stringify(r));
    notes.push(`90 s take: accepted in one request (${r.ms} ms in the browser, stubbed server)`);
  });
  // The on-device recogniser downloads its model from a CDN: here it is replaced, first by a stand-in that
  // answers like it (the "browser" path), then by nothing at all (the even split).
  await step('fallback: the on-device recogniser (stand-in worker) times the take when the server will not', async () => {
    scenario.align = 'free';
    const r = await evaluate(`(async () => {
      const Real = window.Worker; const s = qa.ctx().state;
      const said = s.plan.beats.filter(b => (b.vo || '').trim()).map(b => b.vo.replace(/\\*/g, '')).join(' ').split(/\\s+/);
      window.Worker = class { constructor(url, opts) { this.url = String(url); this.opts = opts; this.l = {}; window.__w = this; } addEventListener(t, f) { this.l[t] = f; } removeEventListener() {} terminate() {}
        postMessage(m) { this.got = { rate16k: m.samples instanceof Float32Array, n: m.samples.length }; setTimeout(() => { this.l.message({ data: { type: 'progress', progress: 50 } }); this.l.message({ data: { id: m.id, type: 'result', text: said.join(' '), chunks: said.map((w, i) => ({ text: ' ' + w.replace(/[,.]/g, ''), timestamp: [0.1 + i * 0.25, 0.3 + i * 0.25] })) } }); }, 30); } };
      const out = await qa.ctx().modules.voiceInput.useFile(qa.wav('device.wav', 8));
      const w = window.__w; window.Worker = Real;
      return { out, url: w?.url, module: w?.opts?.type, got: w?.got, timing: s.voiceOwn?.timing, panel: document.querySelector('#ri-voice-panel').textContent.replace(/\\s+/g, ' '), words: s.timeline.tracks.captions.words.map(x => x.w).join(' ') };
    })()`);
    scenario.align = 'ok';
    expect(r.out.ok && r.out.timing === 'browser' && !r.out.low, JSON.stringify(r.out));
    expect(/reels-whisper-worker\.js/.test(r.url) && r.module === 'module', `worker: ${r.url}`);
    expect(r.got.rate16k && r.got.n === 8 * 16000, `samples: ${JSON.stringify(r.got)}`);
    expect(/timed to your words on this device/.test(r.panel), `panel: ${r.panel}`);
    expect(r.words === SCRIPT.replace(/\*/g, ''), 'captions changed');
  });
  await evaluate(`(window.__RealWorker = window.Worker, window.Worker = undefined, 1)`);
  for (const [align, why] of [['free', 'free mode'], ['fail', 'the call fails']]) {
    await step(`fallback when ${why}: on-device recogniser unavailable -> even split, clearly marked estimated`, async () => {
      scenario.align = align;
      const r = await evaluate(`(async () => { qa.clearToasts(); const out = await qa.ctx().modules.voiceInput.useFile(qa.wav('fallback.wav', 8)); const s = qa.ctx().state; await new Promise(r => setTimeout(r, 200)); const spoken = s.plan.beats.filter(b => (b.vo || '').trim()); return { out, own: spoken.filter(b => s.voice[b.id]?.own && s.voice[b.id]?.estimated).length, spoken: spoken.length, total: spoken.reduce((a, b) => a + s.buffers['vo:' + b.id].duration, 0), badge: document.querySelector('#rm-voice-badge').textContent, panel: document.querySelector('#ri-voice-panel').textContent.replace(/\\s+/g, ' '), nudgeOpen: document.querySelector('#ri-voice-panel .ri-nudge').open, toast: qa.toasts().join(' | '), words: s.timeline.tracks.captions.words.map(w => w.w).join(' ') }; })()`);
      scenario.align = 'ok';
      expect(r.out.ok && r.out.timing === 'estimated' && r.own === r.spoken, `result: ${JSON.stringify(r.out)} own ${r.own}/${r.spoken}`);
      expect(Math.abs(r.total - 8) < 0.05, `the even split should use the whole take, used ${r.total}s`);
      expect(/estimated timing/.test(r.badge) && /estimated timing/.test(r.panel) && r.nudgeOpen, `not marked: ${r.badge} / ${r.panel}`);
      expect(/estimated timing\. Nudge/.test(r.toast), `toast: ${r.toast}`);
      expect(r.words === SCRIPT.replace(/\*/g, ''), 'captions changed');
    });
  }
  await audit('1440-voice-estimated', ['#ri-voice-panel']);
  await evaluate(`(window.Worker = window.__RealWorker, 1)`);
  await step('AI off: no server call at all, still works (estimated)', async () => {
    scenario.ai = false;
    await load();
    await makeScriptReel();
    const n = scenario.seen.filter(s => s === 'voice-align').length;
    const r = await evaluate(`(async () => { const W = window.Worker; window.Worker = undefined; try { return await qa.ctx().modules.voiceInput.useFile(qa.wav('off.wav', 6)); } finally { window.Worker = W; } })()`);
    scenario.ai = true;
    expect(r.ok && r.timing === 'estimated', JSON.stringify(r));
    expect(scenario.seen.filter(s => s === 'voice-align').length === n, 'voice-align was called with AI off');
  });
  await step('removing the voiceover clears it everywhere', async () => {
    const r = await evaluate(`(async () => { const c = qa.ctx(); c.modules.voiceInput.remove(); await new Promise(r => setTimeout(r, 200)); const s = c.state; return { own: Object.values(s.voice).filter(v => v.own).length, vo: s.timeline.tracks.audio.filter(a => a.kind === 'vo').length, badge: document.querySelector('#rm-voice-badge').textContent, saved: c.snapshot().timeline.voiceOwn || null, stored: await c.modules.tray.store.get(s.projectId, 'voice') }; })()`);
    expect(r.own === 0 && r.vo === 0 && r.badge === 'Captions only' && !r.saved && !r.stored, JSON.stringify(r));
  });

  // ── 4. No script yet: the take becomes the reel ──
  await step('no script: the transcript builds a locked-words reel from the take (ReelES.scriptToPlan)', async () => {
    await load();
    const r = await evaluate(`(async () => { const c = qa.ctx(); const out = await c.modules.voiceInput.useFile(qa.wav('just-talking.wav', 8)); await new Promise(r => setTimeout(r, 600)); const s = c.state; return { out, locked: s.plan?.script?.locked, text: s.plan?.script?.text, vo: (s.plan?.beats || []).map(b => b.vo).filter(Boolean).join(' '), own: (s.plan?.beats || []).filter(b => s.voice[b.id]?.own).length, step: s.step, notice: s.notice, source: s.planSource }; })()`);
    expect(r.out.ok && r.locked, JSON.stringify(r));
    expect(r.text === 'Josh Allen did it again on Sunday night. The Bills are now ten and two. Nobody saw this coming in September.' && r.vo === r.text, `words changed: ${r.vo}`);
    expect(r.own >= 2 && r.step === 'edit' && /word for word/.test(r.notice), JSON.stringify(r));
    expect(scenario.seen.some(s => /^event:voice_upload:.*"fromTake":true/.test(s)), 'fromTake was not logged');
  });
  await step('a pasted script with no reel yet: the voiceover makes the reel from the script, word for word', async () => {
    await load();
    expect(await scriptMode(), 'no "Use my exact words" switch (#rm-script-mode)');
    await typeInto('#rm-prompt', SCRIPT);
    expect(await click('#ri-script-voice'), 'no "Record your voiceover" button next to the script (#ri-script-voice)');
    await waitFor(`document.querySelector('#ri-voice').open`, 2000, 'dialog from the Script source');
    expect(await evaluate(`document.querySelectorAll('#ri-voice .ri-prompter li').length`) >= 3, 'the prompter does not show the pasted script');
    await click('#ri-voice [data-ri-close]');
    const r = await evaluate(`(async () => { const c = qa.ctx(); const out = await c.modules.voiceInput.useFile(qa.wav('read.wav', 10)); await new Promise(r => setTimeout(r, 500)); const s = c.state; return { out, vo: s.plan.beats.map(b => b.vo).filter(Boolean).join(' '), matches: c.ES.voMatchesScript(s.plan) }; })()`);
    expect(r.out.ok && r.out.timing === 'ai' && r.vo === SCRIPT && r.matches, JSON.stringify(r));
  });

  // ── 5. Phone ──
  await setViewport(375);
  await load();
  await makeScriptReel();
  await step('375: tray, voice panel and dialog fit; touch targets are 44 px', async () => {
    await evaluate(`(async () => { const c = qa.ctx(); await c.modules.tray.addFiles([await qa.png('one.png'), await qa.webm('two.webm')], { via: 'picker' }); await c.modules.voiceInput.useFile(qa.wav('phone.wav', 7)); document.querySelector('#rm-voice').open = true; document.querySelector('#ri-voice-panel .ri-nudge').open = true; qa.clearToasts(); return 1; })()`);
    await sleep(300);
    const small = await evaluate(`[...document.querySelectorAll('#ri-tray button, #ri-tray select, #ri-voice-panel button')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(e => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`);
    expect(!small.length, `small touch targets: ${small.join(', ')}`);
  });
  await evaluate(`(document.querySelector('#ri-tray').scrollIntoView({ block: 'center' }), 1)`);
  await audit('375-tray', ['#ri-tray']);
  await evaluate(`(document.querySelector('#ri-voice-panel').scrollIntoView({ block: 'center' }), 1)`);
  await audit('375-voice-panel', ['#ri-voice-panel']);
  await evaluate(`(qa.ctx().modules.voiceInput.open(), 1)`);
  await sleep(200);
  await step('375: the voiceover dialog sits inside the screen', async () => {
    const r = await evaluate(`(() => { const d = document.querySelector('#ri-voice'); const b = d.getBoundingClientRect(); const inner = [...d.querySelectorAll('button, .ri-prompter')].map(e => e.getBoundingClientRect()).filter(x => x.width > 0); return { left: Math.round(b.left), right: Math.round(b.right), vw: document.documentElement.clientWidth, worst: Math.round(Math.max(...inner.map(x => x.right))) }; })()`);
    expect(r.left >= 0 && r.right <= r.vw && r.worst <= r.right, JSON.stringify(r));
  });
  await audit('375-voice-dialog', ['#rm-toasts']); // the audit adds every open dialog itself
  await click('#ri-voice [data-ri-close]');
  await click('#rm-next');
  await waitFor(`!document.querySelector('#rm-pane-export').hidden`, 4000, 'Export step');
  await evaluate(`(document.querySelector('#ri-captions').scrollIntoView({ block: 'center' }), 1)`);
  await audit('375-export-captions', ['#ri-captions']);
} catch (error) {
  failures.push(`harness: ${error.stack || error.message}`);
} finally {
  cleanup();
}
notes.forEach(n => console.log(`note ${n}`));
if (failures.length) { console.log(`\nreels inputs ui: ${failures.length} problem(s)`); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
console.log(`\nreels inputs ui: all ${stepN} steps passed (1440 and 375, light and dark).`);
