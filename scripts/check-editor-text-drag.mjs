#!/usr/bin/env node
// Social Media editor, real headless Chrome (CDP, no npm deps):
//  1. Cover text drag: with a background photo loaded, desktop (one long menu,
//     studioInspector 'all') puts the photo in crop mode. Pressing on the pills
//     must drag the TEXT (state.textBlockX/Y), not the photo, and the export
//     (renderExportImage) must draw the pills where they were dropped. A press
//     off the text still moves the photo. Unmoved text exports identically.
//  2. Multiple Tweets "Hide reply @mentions": on by default, strips the leading
//     @handles in what is drawn / exported, keeps middle ones, turning it off
//     brings them back, and the choice is remembered (localStorage).
// Run: node scripts/check-editor-text-drag.mjs   (skips if Chrome isn't installed)
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
if (!CHROME) { console.log('editor text drag: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('editor text drag: skipped (needs Node with WebSocket)'); process.exit(0); }

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-drag-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const cdpPort = new URL(wsUrl).port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };

const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/*'] });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// A fake, unexpired, unsigned session: only the page's own gate reads it (APIs are stubbed).
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const email='qa@essentiallysports.com'; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email,exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email,aud:'authenticated',role:'authenticated'}}));
  let h=0x811c9dc5; for (const ch of email) { h^=ch.codePointAt(0); h=Math.imul(h,0x01000193)>>>0; }
  const never=JSON.stringify({welcome:'never'}); localStorage.setItem('frameup.tours.v1:u'+h.toString(36), never); localStorage.setItem('frameup.tours.v1:device', never); sessionStorage.setItem('frameup.tours.offered','1'); return true; })()`;

async function boot() {
  await send('Page.navigate', { url: `${base}/__blank` });
  for (let i = 0; i < 40 && (await evaluate('location.href').catch(() => '')) !== `${base}/__blank`; i++) await sleep(150);
  await evaluate(SESSION);
  await send('Page.navigate', { url: `${base}/index.html#instagram` });
  for (let i = 0; i < 60; i++) { await sleep(400); const ok = await evaluate("Boolean(document.querySelector('.app[data-workspace] > .panel')) && document.documentElement.style.visibility !== 'hidden' && Boolean(window.FrameUpEditorUI?.ready)").catch(() => false); if (ok) break; }
  const where = await evaluate('location.pathname + location.hash');
  if (/login/.test(where)) throw new Error('page went to ' + where + ' (sign-in gate)');
  await sleep(800);
  await evaluate(`document.querySelectorAll('.fu-tour-toast, .fu-offer').forEach(n => n.remove()), 1`);
}

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
async function drag(from, to) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, buttons: 0 });
  await mouse('mousePressed', from.x, from.y);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(150);
}

try {
  await boot();

  // ── 1. Cover text drag over a photo ──
  await evaluate(String.raw`(async () => {
    const select = document.querySelector('#instagram-post-type-select');
    if (select && select.value !== 'cover') { select.value = 'cover'; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 450)); }
    const ta = document.getElementById('pill-text');
    ta.value = 'DRAG ME\nAROUND THE SLIDE';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
    const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 1080, 1350);
    grad.addColorStop(0, '#2a6f97'); grad.addColorStop(1, '#e9c46a'); g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
    const img = new Image(); img.src = c.toDataURL('image/png'); await img.decode();
    state.photo = img; state.photoName = 'qa-gradient.png';
    render(); window.ESSyncCanvasImageEditMode?.();
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);
  const setup = await evaluate(`({ inspector: document.body.dataset.studioInspector, imageMode: isCanvasImageEditMode(), bounds: state.lastTextBounds, x: state.textBlockX, y: state.textBlockY, photoX: state.photoOffsetX, photoY: state.photoOffsetY, rects: state.textHitRects })`);
  check(setup.inspector === 'all', `desktop inspector should be 'all' (got ${setup.inspector})`);
  check(setup.imageMode === true, 'photo crop mode should be on with a background photo (the case that broke the drag)');
  check(setup.bounds && setup.bounds.w > 0, 'cover pills drawn (lastTextBounds)');

  // Unmoved: export is the same before and after a press-free re-render.
  const exportHash = `(() => { const { offscreen } = renderExportImage(); const d = offscreen.getContext('2d').getImageData(0, 0, offscreen.width, offscreen.height).data; let h = 0x811c9dc5; for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; })()`;
  const before1 = await evaluate(exportHash);
  await evaluate('render(), 1');
  const before2 = await evaluate(exportHash);
  check(before1 === before2, 'unmoved text: export is stable across renders');

  const toClient = `((x, y) => { const c = document.getElementById('preview'); const r = c.getBoundingClientRect(); const w = getWorkspace(); return { x: r.left + x / w.width * r.width, y: r.top + y / w.height * r.height, ratio: r.height / w.height }; })`;
  const pill = setup.rects[0];
  const from = await evaluate(`${toClient}(${pill.x + pill.w / 2}, ${pill.y + pill.h / 2})`);
  const dy = -400; // canvas px, upwards
  await drag(from, { x: from.x, y: from.y + dy * from.ratio });
  const after = await evaluate(`({ x: state.textBlockX, y: state.textBlockY, moved: state.textBlockUserMoved, photoX: state.photoOffsetX, photoY: state.photoOffsetY, dragging: state.isDraggingText, rects: state.textHitRects, cls: document.querySelector('.canvas-wrap').className })`);
  check(after.moved === true, 'dragging the pills marks textBlockUserMoved');
  check(Math.abs((after.y - setup.y) - dy) < 12, `text block moved up ~400px (moved ${Math.round(after.y - setup.y)})`);
  check(after.photoX === setup.photoX && after.photoY === setup.photoY, 'the photo did not move when dragging the text');
  check(after.dragging === false && !/is-dragging/.test(after.cls), 'drag ended cleanly');

  // Export draws the pills at the dropped position: the pill fill sampled on the
  // preview matches the export at the same (scaled) point, and the export changed.
  const sample = await evaluate(String.raw`(() => {
    const r = state.textHitRects[0];
    const px = Math.round(r.x + 6), py = Math.round(r.y + r.h / 2);
    const prev = document.getElementById('preview').getContext('2d').getImageData(px, py, 1, 1).data;
    const { offscreen, scale } = renderExportImage();
    const ex = offscreen.getContext('2d').getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data;
    return { prev: [...prev], ex: [...ex], previewW: document.getElementById('preview').width, w: getWorkspace().width };
  })()`);
  if (sample.previewW === sample.w) {
    const diff = Math.max(...[0, 1, 2].map(i => Math.abs(sample.prev[i] - sample.ex[i])));
    check(diff <= 24, `export pill fill matches preview at the dropped spot (preview ${sample.prev} vs export ${sample.ex})`);
  }
  const moved = await evaluate(exportHash);
  check(moved !== before1, 'export changed after the drag');

  // Safe area: dragging far off the top keeps the pills inside the canvas.
  const top = await evaluate(`${toClient}(${after.rects[0].x + after.rects[0].w / 2}, ${after.rects[0].y + after.rects[0].h / 2})`);
  await drag(top, { x: top.x, y: top.y - 2000 * top.ratio });
  const clamped = await evaluate(`({ minY: Math.min(...state.textHitRects.map(r => r.y)) })`);
  check(clamped.minY >= 0, `pills stay inside the safe area when dragged off the top (minY ${clamped.minY})`);

  // A press OFF the text still moves the photo (crop mode keeps working).
  const textBefore = await evaluate('state.textBlockY');
  const off = await evaluate(`${toClient}(60, getWorkspace().height - 60)`);
  await drag(off, { x: off.x + 80, y: off.y - 80 });
  const photoAfter = await evaluate('({ x: state.photoOffsetX, y: state.photoOffsetY, textY: state.textBlockY })');
  check(photoAfter.textY === textBefore, 'a press off the text does not move the text');
  check(photoAfter.x !== setup.photoX || photoAfter.y !== setup.photoY, 'a press off the text still drags the photo');

  // Hover affordance.
  const hov = await evaluate(`${toClient}(${(await evaluate('state.textHitRects[0].x + state.textHitRects[0].w / 2'))}, ${(await evaluate('state.textHitRects[0].y + state.textHitRects[0].h / 2'))})`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hov.x, y: hov.y, buttons: 0 });
  await sleep(60);
  const cursor = await evaluate(`({ cls: document.querySelector('.canvas-wrap').classList.contains('is-text-hover'), cursor: getComputedStyle(document.getElementById('preview')).cursor })`);
  check(cursor.cls && cursor.cursor === 'grab', `hovering the text shows a grab cursor (class ${cursor.cls}, cursor ${cursor.cursor})`);

  // ── 2. Multiple Tweets: Hide reply @mentions ──
  const multi = await evaluate(String.raw`(async () => {
    const select = document.querySelector('#instagram-post-type-select');
    select.value = 'twitter-multi'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 450));
    const base = { authorName: 'Fan', handle: 'fan', dateLabel: '1h', avatarDataUrl: '', avatarUrl: '', verified: false, url: 'https://x.com/fan/status/1' };
    state.multiTweets = [
      { ...base, text: '@AdamSchefter Awfully convenient' },
      { ...base, text: '@AdamSchefter @ESPNNFL Oddly convenient, ask @NFL about it' },
      { ...base, text: '@AdamSchefter' },
    ];
    render();
    const toggle = document.getElementById('multi-tweet-hide-mentions');
    const visible = toggle && toggle.getClientRects().length > 0;
    const on = getMultiTweets().map(t => t.text);
    const payloadOn = getTwitterMultiPayload().fields.tweets.map(t => t.text);
    const hashOn = (() => { const { offscreen } = renderExportImage(); return offscreen.toDataURL().length; })();
    toggle.click();
    const off = getMultiTweets().map(t => t.text);
    const stored = localStorage.getItem('frameup.multiTweet.hideReplyMentions');
    const aria = toggle.getAttribute('aria-checked');
    const hashOff = (() => { const { offscreen } = renderExportImage(); return offscreen.toDataURL().length; })();
    toggle.click();
    return { visible, on, payloadOn, off, stored, aria, ariaBack: toggle.getAttribute('aria-checked'), storedBack: localStorage.getItem('frameup.multiTweet.hideReplyMentions'), raw: state.multiTweets.map(t => t.text), exportDiffers: hashOn !== hashOff };
  })()`);
  check(multi.visible, 'Hide reply @mentions switch is visible with the multi-tweet inputs');
  check(JSON.stringify(multi.on) === JSON.stringify(['Awfully convenient', 'Oddly convenient, ask @NFL about it', '@AdamSchefter']), `on: leading handles stripped, middle kept, all-handles kept (${JSON.stringify(multi.on)})`);
  check(JSON.stringify(multi.payloadOn) === JSON.stringify(multi.on), 'payload uses the stripped text');
  check(multi.off[0] === '@AdamSchefter Awfully convenient' && multi.off[1].startsWith('@AdamSchefter @ESPNNFL'), 'off: handles kept');
  check(multi.stored === '0' && multi.aria === 'false', 'turning it off is remembered (localStorage 0, aria-checked false)');
  check(multi.storedBack === '1' && multi.ariaBack === 'true', 'turning it back on is remembered');
  check(multi.raw[0] === '@AdamSchefter Awfully convenient', 'stored tweet text is never modified');
  check(multi.exportDiffers, 'the export differs with the switch on vs off');

  // Remembered across a reload.
  await evaluate(`localStorage.setItem('frameup.multiTweet.hideReplyMentions', '0'), 1`);
  await boot();
  const reloaded = await evaluate(`({ on: multiTweetHideMentions, aria: document.getElementById('multi-tweet-hide-mentions').getAttribute('aria-checked') })`);
  check(reloaded.on === false && reloaded.aria === 'false', 'off survives a reload');
  await evaluate(`localStorage.removeItem('frameup.multiTweet.hideReplyMentions'), 1`);

  for (const e of errors) failures.push(e);
} catch (error) {
  failures.push('run error: ' + (error.stack || error.message));
} finally {
  cleanup();
}

if (failures.length) {
  console.log(`editor text drag: ${failures.length} failure(s)`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('editor text drag + reply mentions: all checks passed.');
process.exit(0);
