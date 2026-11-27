// Custom logos in the real editor (index.html), headless Chrome over CDP, with
// Supabase REST + Storage mocked by request interception (nothing real is
// called; the table and bucket live in this script's memory):
//   upload (PNG) -> square crop (drag, keys, zoom) -> saved (2 objects in the
//   person's folder + a row) -> placed in the Player Stat Line logo slot ->
//   export canvas contains it and is not tainted; My logos lists it with a
//   thumbnail; rename (PATCH) and delete with confirm (DELETE row + files);
//   Custom brand logo from an SVG on a Cover post, export has it top right;
//   reload brings the brand logo back from storage (authenticated download);
//   missing table -> clear note, upload works for this tab, no errors;
//   bad type / over 5 MB messages; light + dark; 1440 and 375.
// Run: node scripts/check-custom-logos.mjs   (skips without Chrome)
//      LOGO_SHOTS=<dir> saves screenshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('custom logos ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('custom logos ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.LOGO_SHOTS ? path.resolve(process.env.LOGO_SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const UID = '00000000-0000-0000-0000-000000000001';

// ── Tiny PNG encoder (RGBA) for fixtures ──
function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = pixel(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Magenta disc on a see-through 2:1 canvas (the colour we look for in exports).
const MAGENTA = [255, 0, 204];
const wide = png(400, 200, (x, y) => ((x - 200) ** 2 + (y - 100) ** 2 < 90 ** 2 ? [...MAGENTA, 255] : [0, 0, 0, 0]));
const stored = png(64, 64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 28 ** 2 ? [0, 200, 120, 255] : [0, 0, 0, 0]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-logos-'));
const F = {
  png: path.join(dir, 'bulls_alt.png'),
  svg: path.join(dir, 'Brand mark.svg'),
  gif: path.join(dir, 'anim.gif'),
  big: path.join(dir, 'huge.png'),
};
fs.writeFileSync(F.png, wide);
// A script and an external image in the SVG must do nothing (static image mode).
fs.writeFileSync(F.svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>window.__svgRan = true</script><image href="https://blocked.example/x.png" width="10" height="10"/><rect x="10" y="10" width="80" height="80" rx="16" fill="rgb(0,170,255)"/></svg>`);
fs.writeFileSync(F.gif, Buffer.from('GIF89a'));
fs.writeFileSync(F.big, Buffer.concat([wide, Buffer.alloc(5 * 1024 * 1024 + 10)]));

// ── Mock Supabase ──
const db = { rows: [], missing: false, objects: new Map() };
const log = [];
const { server, base } = await startServer({});
const chrome = await startChrome(CHROME);
const { send, evaluate } = chrome;
const errors = [];
const json = (requestId, status, body, extra = []) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, ...extra], body: Buffer.from(body == null ? '' : JSON.stringify(body)).toString('base64') });
chrome.on(m => {
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const u = new URL(request.url);
  const method = request.method;
  if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) { send('Fetch.continueRequest', { requestId }); return; }
  if (method === 'OPTIONS') { send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' }], body: '' }); return; }
  if (/blocked\.example/.test(u.host)) { log.push(['svg-external', u.href]); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
  if (u.pathname.startsWith('/rest/v1/frameup_custom_logos')) {
    log.push(['rest', method, u.search, request.postData || '']);
    if (db.missing) { json(requestId, 404, { code: 'PGRST205', message: "Could not find the table 'public.frameup_custom_logos' in the schema cache" }); return; }
    const idEq = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    if (method === 'GET') { json(requestId, 200, db.rows); return; }
    if (method === 'POST') {
      const row = { ...JSON.parse(request.postData || '{}'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_used_at: null };
      db.rows.push(row);
      json(requestId, 201, row);
      return;
    }
    if (method === 'PATCH') { const row = db.rows.find(r => r.id === idEq); if (row) Object.assign(row, JSON.parse(request.postData || '{}')); json(requestId, 204, null); return; }
    if (method === 'DELETE') { db.rows = db.rows.filter(r => r.id !== idEq); json(requestId, 204, null); return; }
  }
  if (u.pathname.startsWith('/storage/v1/object/custom-logos')) {
    const key = decodeURIComponent(u.pathname.replace('/storage/v1/object/custom-logos', '').replace(/^\//, ''));
    log.push(['storage', method, key, method === 'DELETE' ? request.postData || '' : '']);
    if (db.missing) { json(requestId, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }); return; }
    if (method === 'POST' || method === 'PUT') { db.objects.set(key, true); json(requestId, 200, { Key: 'custom-logos/' + key, Id: 'x' }); return; }
    if (method === 'GET') { send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: stored.toString('base64') }); return; }
    if (method === 'DELETE') { (JSON.parse(request.postData || '{}').prefixes || []).forEach(k => db.objects.delete(k)); json(requestId, 200, []); return; }
  }
  if (u.pathname.startsWith('/storage/v1/object/public') || u.pathname.includes('/getPublicUrl')) log.push(['PUBLIC', u.href]);
  if (u.pathname === '/auth/v1/user') { json(requestId, 200, { id: UID, email: 'qa@essentiallysports.com', aud: 'authenticated', role: 'authenticated' }); return; }
  if (u.pathname.startsWith('/rest/v1/')) { json(requestId, 200, []); return; }
  json(requestId, 200, null);
});
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });

const fails = [];
let checks = 0;
const ok = (cond, what) => { checks += 1; if (!cond) fails.push(what); };
const ev = expr => evaluate(expr);
async function until(expr, what, ms = 10000) {
  for (let t = 0; t < ms; t += 100) { if (await ev(expr).catch(() => false)) return true; await sleep(100); }
  fails.push('timed out: ' + what);
  return false;
}
const click = s => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return false; e.click(); return true; })()`);
const key = (k, o = {}) => ev(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, shiftKey: ${!!o.shift} })); return true; })()`);
async function setFile(selector, file) {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }).then(r => r.result);
  const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector })).result;
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
async function shot(name) {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
// Pixels of a colour in the editor's export canvas (and proof it is not tainted).
const COUNT = (rgb, region = null) => `(() => {
  const { offscreen } = renderExportImage();
  const url = offscreen.toDataURL('image/png');
  const ctx = offscreen.getContext('2d');
  const r = ${JSON.stringify(region)} || [0, 0, 1, 1];
  const x0 = Math.floor(r[0] * offscreen.width), y0 = Math.floor(r[1] * offscreen.height);
  const w = Math.max(1, Math.floor((r[2] - r[0]) * offscreen.width)), h = Math.max(1, Math.floor((r[3] - r[1]) * offscreen.height));
  const d = ctx.getImageData(x0, y0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ${rgb[0]}) < 30 && Math.abs(d[i + 1] - ${rgb[1]}) < 30 && Math.abs(d[i + 2] - ${rgb[2]}) < 30) n++;
  return { n, png: url.length > 1000, w: offscreen.width, h: offscreen.height };
})()`;

async function load({ width = 1440, theme = 'light', hash = 'instagram' } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 812 : 900, deviceScaleFactor: 1, mobile: width < 768 });
  await send('Page.navigate', { url: `${base}/__blank` });
  await sleep(200);
  await ev(FAKE_SESSION);
  await ev(`(() => { localStorage.setItem('frameup.theme', ${JSON.stringify(theme)}); const email='qa@essentiallysports.com'; let h=0x811c9dc5; for (const ch of email) { h^=ch.codePointAt(0); h=Math.imul(h,0x01000193)>>>0; } const never=JSON.stringify({welcome:'never'}); localStorage.setItem('frameup.tours.v1:u'+h.toString(36), never); localStorage.setItem('frameup.tours.v1:device', never); sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); return true; })()`);
  await send('Page.navigate', { url: `${base}/index.html#${hash}` });
  await until("Boolean(document.querySelector('.app[data-workspace] > .panel')) && document.documentElement.style.visibility !== 'hidden' && Boolean(window.FrameUpEditorUI?.ready) && Boolean(window.FrameUpLogoPicker && window.FrameUpCustomLogos?.store)", 'editor ready', 30000);
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(s); document.querySelectorAll('.fu-tour-toast, .fu-offer').forEach(n => n.remove()); window.FrameUpTheme?.apply ? FrameUpTheme.apply(${JSON.stringify(theme)}) : document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); return true; })()`);
  await sleep(600);
}
const setPostType = v => ev(`(() => { const s = document.getElementById('instagram-post-type-select'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const AUDIT_DIALOG = sel => `(() => {
  const out = [];
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root || !root.open) return ['not open'];
  const vis = e => e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0;
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways');
  root.querySelectorAll('button,input').forEach(e => { if (!vis(e) || e.type === 'file') return; const name = (e.getAttribute('aria-label') || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || e.textContent || e.title || '').trim(); if (!name) out.push('no name: ' + e.outerHTML.slice(0, 80)); });
  const box = root.querySelector('section').getBoundingClientRect();
  if (box.right > innerWidth + 1 || box.left < -1) out.push('dialog wider than the screen');
  root.querySelectorAll('img').forEach(i => { if (vis(i) && i.complete && i.naturalWidth === 0) out.push('broken image'); });
  const prim = [...root.querySelectorAll('.es-btn--primary')].filter(vis); if (prim.length > 1) out.push('primary buttons: ' + prim.length);
  return out;
})()`;

// ─── 1. Upload -> crop -> place on Player Stat Line -> export ─────────────
await load();
await setPostType('player-stat-line');
await sleep(400);
const before = await ev(COUNT(MAGENTA));
ok(before.png, 'export canvas readable before');
await click('[data-template-logo-open="player-stat-line"]');
await until("document.querySelector('dialog.flp')?.open", 'picker opens');
await click('[data-flp-chip="uploads"]');
await until("document.querySelector('[data-flp-grid] .es-empty') && /No logos yet/.test(document.querySelector('[data-flp-grid]').textContent)", 'empty My logos state');
ok(await ev("document.querySelector('[data-flp-chip=\"uploads\"]').textContent.trim() === 'My logos'"), 'chip is called My logos');
await shot('01-my-logos-empty-light');

// Wrong type and too big: a message, no dialog.
await setFile('[data-flp-file]', F.gif);
await until("/PNG, JPG, WebP or SVG/.test(document.querySelector('[data-flp-status]').textContent)", 'gif refused');
await setFile('[data-flp-file]', F.big);
await until("/5 MB/.test(document.querySelector('[data-flp-status]').textContent)", 'over 5 MB refused');
ok(!(await ev("document.querySelector('dialog.fcl')?.open || false")), 'no crop dialog for bad files');

await setFile('[data-flp-file]', F.png);
await until("document.querySelector('dialog.fcl')?.open", 'crop dialog opens');
await sleep(300);
ok(await ev("document.querySelector('[data-fcl-name]').value === 'bulls alt'"), 'name from the file');
ok(await ev("document.activeElement === document.querySelector('[data-fcl-stage]')"), 'focus on the crop area');
// The stage shows the logo (some magenta pixels), see-through corners stay clear.
const stage = await ev(`(() => { const c = document.querySelector('[data-fcl-canvas]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] < 60 && d[i+2] > 150) m++; return { m, corner: d[3] }; })()`);
ok(stage.m > 1000, 'crop stage draws the logo');
ok(stage.corner === 0, 'transparent corner stays transparent');
const z0 = await ev('Number(document.querySelector("[data-fcl-range]").value)');
await key('+');
await sleep(100);
const z1 = await ev('Number(document.querySelector("[data-fcl-range]").value)');
ok(z1 > z0, 'plus zooms in');
await key('0');
await sleep(80);
ok(await ev('Number(document.querySelector("[data-fcl-range]").value) === 1'), '0 fits again');
await click('[data-fcl-fit="fill"]');
await sleep(80);
ok(await ev('Math.abs(Number(document.querySelector("[data-fcl-range]").value) - 2) < 0.01'), 'Fill square = 2x for a 2:1 logo');
// Drag the stage with the mouse (pointer events).
const rect = await ev("(() => { const r = document.querySelector('[data-fcl-stage]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 40, y: rect.y, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 40, y: rect.y, button: 'left', clickCount: 1 });
await sleep(100);
await click('[data-fcl-fit="contain"]');
await sleep(80);
ok((await ev(AUDIT_DIALOG('dialog.fcl'))).length === 0, 'crop dialog audit (1440 light): ' + (await ev(AUDIT_DIALOG('dialog.fcl'))).join('; '));
await shot('02-crop-light');
await ev("(() => { const n = document.querySelector('[data-fcl-name]'); n.value = 'Bulls alternate'; n.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await click('[data-fcl-save]');
await until("!document.querySelector('dialog.fcl')?.open && !document.querySelector('dialog.flp')?.open", 'crop + picker close after save');
const uploads = log.filter(l => l[0] === 'storage' && l[1] === 'POST').map(l => l[2]);
ok(uploads.length === 2 && uploads.every(k => k.startsWith(UID + '/')) && uploads.some(k => /-thumb\.png$/.test(k)), 'two PNGs in the person\'s folder: ' + uploads.join(', '));
ok(db.rows.length === 1 && db.rows[0].owner_id === UID && db.rows[0].name === 'Bulls alternate' && db.rows[0].width === 1024 && db.rows[0].bytes > 0, 'row saved: ' + JSON.stringify(db.rows[0] || {}).slice(0, 200));
ok(await ev("/^data:image\\/png;base64,/.test(state.playerStatLineData.logo.src) && state.playerStatLineData.logo.mode === 'upload'"), 'Player Stat Line logo is the custom PNG');
await until("Boolean(document.querySelector('[data-template-logo-slot=\"player-stat-line\"] img')?.naturalWidth)", 'logo slot shows it');
ok(await ev("document.querySelector('[data-template-logo-slot=\"player-stat-line\"]').textContent.includes('Bulls alternate')"), 'slot names it');
ok(await ev("(() => { const i = new Image(); i.src = state.playerStatLineData.logo.src; return i.decode().then(() => i.naturalWidth === 1024 && i.naturalHeight === 1024); })()"), 'placed image is 1024 x 1024 (full quality)');
await sleep(500);
const after = await ev(COUNT(MAGENTA));
ok(after.png && after.n > before.n + 500, `export contains the logo (magenta ${before.n} -> ${after.n}), canvas not tainted`);
ok(log.some(l => l[0] === 'rest' && l[1] === 'PATCH' && /last_used_at/.test(l[3])), 'last used saved on pick');

// ─── 2. My logos lists it; rename; delete with confirm ────────────────────
await click('[data-template-logo-open="player-stat-line"]');
await until("document.querySelector('dialog.flp')?.open && document.querySelector('[data-flp-chip=\"uploads\"]')?.getAttribute('aria-pressed') === 'true'", 'opens on My logos (current is custom)');
await until("Boolean(document.querySelector('img[data-flp-thumb]:not([hidden])')?.naturalWidth)", 'thumbnail loads');
ok(await ev("document.querySelector('.flp__tile.is-selected [data-flp-pick^=\"custom:\"]') !== null"), 'the placed logo is marked selected');
await shot('03-my-logos-light');
await click('[data-flp-rename]');
await until("document.activeElement?.matches('[data-flp-rename-input]')", 'rename field focused');
await ev("(() => { document.activeElement.value = 'Bulls 2026'; return 1; })()");
await key('Enter');
await until("document.querySelector('.flp__name')?.textContent === 'Bulls 2026'", 'renamed in the grid');
ok(db.rows[0]?.name === 'Bulls 2026', 'rename saved (PATCH)');
ok(await ev("document.activeElement?.matches('[data-flp-rename]')"), 'focus back on Rename');
await click('[data-flp-delete-custom]');
await until("Boolean(document.querySelector('[data-flp-confirm-delete]'))", 'delete asks first');
ok(await ev("document.activeElement?.matches('[data-flp-cancel-delete]')"), 'focus on Keep');
ok(db.rows.length === 1, 'nothing deleted before confirming');
await key('Escape');
await sleep(100);
ok(await ev("document.querySelector('dialog.flp').open && !document.querySelector('[data-flp-confirm-delete]')"), 'Esc cancels the confirm, not the picker');
await click('[data-flp-delete-custom]');
await until("Boolean(document.querySelector('[data-flp-confirm-delete]'))", 'confirm again');
await shot('04-delete-confirm-light');
await click('[data-flp-confirm-delete]');
await until("/No logos yet/.test(document.querySelector('[data-flp-grid]').textContent)", 'empty after delete');
ok(db.rows.length === 0, 'row deleted');
ok(log.some(l => l[0] === 'storage' && l[1] === 'DELETE' && /-thumb\.png/.test(l[3])), 'files removed from storage');
await click('[data-flp-close]');

// ─── 3. Custom brand logo (SVG) on a Tweet post (its corner logo always draws) ──
await setPostType('twitter-quote');
await sleep(300);
ok(await ev("document.querySelectorAll('[data-brand-logo]').length === 4"), 'brand logo has a 4th Custom option');
await click('[data-brand-logo="custom"]');
await until("document.querySelector('dialog.flp')?.open && document.querySelector('dialog.flp').classList.contains('is-only-custom')", 'custom-only picker');
ok(await ev("document.querySelector('[data-flp-chips]').getBoundingClientRect().height === 0 && getComputedStyle(document.querySelector('[data-flp-chips]')).visibility === 'hidden'"), 'no league chips in custom-only mode');
ok(await ev("document.querySelector('[data-flp-grid]').getBoundingClientRect().height > 200"), 'grid keeps the tall row in custom-only mode');
await setFile('[data-flp-file]', F.svg);
await until("document.querySelector('dialog.fcl')?.open", 'crop dialog for the SVG');
await sleep(300);
ok(!(await ev('Boolean(window.__svgRan)')), 'SVG script never runs');
ok(await ev("document.querySelector('[data-fcl-alpha]').textContent.includes('See-through')"), 'SVG keeps transparency note');
ok(await ev("![...document.querySelectorAll('svg script')].length"), 'SVG markup not in the page');
await click('[data-fcl-save]');
await until("activeBrandLogo === 'custom' && Boolean(BRAND_LOGOS.custom) && !document.querySelector('dialog.flp')?.open", 'brand logo set to the custom logo');
ok(!log.some(l => l[0] === 'svg-external'), 'SVG external image never fetched');
await until("Boolean(document.querySelector('[data-brand-custom-art] img')?.naturalWidth)", 'Custom option shows the logo');
ok(await ev("!document.querySelector('[data-brand-custom-row]').hidden && /Brand mark/.test(document.querySelector('[data-brand-custom-name]').textContent)"), 'Change logo row with the name');
await sleep(500);
const brand = await ev(COUNT([0, 170, 255], [0.7, 0, 1, 0.3]));
ok(brand.png && brand.n > 300, 'export has the custom brand logo top right (' + brand.n + ' px)');
await ev(`(() => { const c = document.getElementById('brand-logo-control'); const sec = c.closest('.studio-accordion, [class*="studio-section"], section'); const t = sec?.querySelector('.studio-accordion-trigger[aria-expanded="false"]'); t?.click(); c.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(300);
ok(await ev("(() => { const opts = [...document.querySelectorAll('[data-brand-logo]')].map(o => o.getBoundingClientRect()); return opts.every(r => r.width > 40 && Math.abs(r.height - opts[0].height) < 1 && Math.abs(r.top - opts[0].top) < 1); })()"), 'four brand options on one row, same size');
await shot('05-brand-custom-light');

// ─── 4. Reload: brand logo comes back from storage ───────────────────────
await load();
await setPostType('twitter-quote');
await until("activeBrandLogo === 'custom' && Boolean(BRAND_LOGOS.custom)", 'custom brand logo restored after reload');
ok(log.some(l => l[0] === 'storage' && l[1] === 'GET' && !/-thumb/.test(l[2])), 'restored with an authenticated download');
await sleep(500);
const restored = await ev(COUNT([0, 200, 120], [0.7, 0, 1, 0.3]));
ok(restored.n > 100, 'restored logo in the export (' + restored.n + ' px)');
// Dark + phone checks of the picker and crop dialog.
await ev("FrameUpTheme?.apply ? FrameUpTheme.apply('dark') : document.documentElement.setAttribute('data-theme','dark')");
await click('[data-brand-custom-change]');
await until("document.querySelector('dialog.flp')?.open", 'Change logo opens the picker');
await until("Boolean(document.querySelector('img[data-flp-thumb]:not([hidden])')?.naturalWidth)", 'thumb from storage');
ok(await ev("[...document.querySelectorAll('.flp__tile')].length === 1"), 'one logo in the library');
await shot('06-my-logos-dark');
ok((await ev(AUDIT_DIALOG('dialog.flp'))).length === 0, 'picker audit dark: ' + (await ev(AUDIT_DIALOG('dialog.flp'))).join('; '));
await setFile('[data-flp-file]', F.png);
await until("document.querySelector('dialog.fcl')?.open", 'crop dialog in dark');
await sleep(200);
await shot('07-crop-dark');
ok((await ev(AUDIT_DIALOG('dialog.fcl'))).length === 0, 'crop audit dark: ' + (await ev(AUDIT_DIALOG('dialog.fcl'))).join('; '));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await until("!document.querySelector('dialog.fcl')?.open", 'Esc cancels the crop');
ok(await ev("document.querySelector('dialog.flp').open"), 'picker still open after cancelling the crop');
await click('[data-flp-close]');

await load({ width: 375 });
await setPostType('cover');
await sleep(300);
await ev("openCustomBrandPicker(), 1");
await until("document.querySelector('dialog.flp')?.open", 'picker on phone');
await setFile('[data-flp-file]', F.png);
await until("document.querySelector('dialog.fcl')?.open", 'crop on phone');
await sleep(200);
const phone = await ev(AUDIT_DIALOG('dialog.fcl'));
ok(phone.length === 0, 'crop audit 375: ' + phone.join('; '));
ok(await ev("document.querySelector('[data-fcl-save]').getBoundingClientRect().bottom <= innerHeight + 1"), 'Save visible on phone');
await shot('08-crop-375');
await key('Escape');

// ─── 5. Missing table / bucket: this tab only, no errors ─────────────────
db.missing = true;
db.rows = [];
await load();
await setPostType('team-record');
await sleep(300);
await click('[data-template-logo-open="team-record"]');
await until("document.querySelector('dialog.flp')?.open", 'picker opens (missing table)');
await click('[data-flp-chip="uploads"]');
await until("!document.querySelector('[data-flp-session]').hidden && /this tab only/.test(document.querySelector('[data-flp-session]').textContent)", 'clear note when the table is missing');
ok(await ev("document.querySelector('[data-flp-session]').getBoundingClientRect().height < 80 && document.querySelector('[data-flp-grid]').getBoundingClientRect().height > 200"), 'note is one short row; grid keeps the space');
await shot('09-missing-table');
await setFile('[data-flp-file]', F.png);
await until("document.querySelector('dialog.fcl')?.open", 'crop opens (missing table)');
await click('[data-fcl-save]');
await until("!document.querySelector('dialog.flp')?.open", 'saved for this tab');
ok(await ev("/^data:image\\/png;base64,/.test(state.teamRecordData.logo.src)"), 'placed on Team Record without the table');
ok(!log.some(l => l[0] === 'storage' && l[1] === 'POST' && db.missing && l[2].includes('Brand') ), 'no stray uploads');
await click('[data-template-logo-open="team-record"]');
await until("/This tab only/.test(document.querySelector('[data-flp-grid]').textContent)", 'tile says This tab only');
await click('[data-flp-close]');

ok(!log.some(l => l[0] === 'PUBLIC'), 'never a public storage URL');
const realErrors = errors.filter(e => !/favicon|fonts\.g|ERR_|Failed to load resource|blocked\.example/.test(e));
ok(realErrors.length === 0, 'no console errors / exceptions: ' + realErrors.slice(0, 5).join(' | '));

chrome.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
if (fails.length) {
  console.error(`custom logos ui: ${fails.length} of ${checks} checks failed`);
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`custom logos ui: ${checks} checks ok`);
