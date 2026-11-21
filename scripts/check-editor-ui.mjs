// Editor UI sweep: every Social / YouTube / Newsletter template, in light and
// dark, at 1440, 1024 and 375, in real headless Chrome (CDP, no npm deps).
// Desktop states: every template with every inspector section open, a layer
// selected, the export menu, the dock's ES Image Pool search, and the Layers
// column open and collapsed. Phone states: every bottom-nav sheet per template.
// Fails on:
//   1  doubled borders (a control's box inside an equally sized bordered box)
//   2  empty bands (a visible section with no content; an empty gap between dividers)
//   3  clipped text / controls escaping their container
//   4  horizontal page (or inspector) scroll
//   5  misaligned siblings (buttons in a row, cards in a row of different heights)
//   6  off-grid spacing (not a multiple of 4): reported, fails only above a baseline
//   7  non-ES fonts and purple in UI chrome
//   8  unlabelled controls; more than one primary button in view
//   9  console errors and uncaught exceptions
//   10 broken images
//   11 contrast below 4.5:1 (small text) / 3:1 (large text)
//   +  the canvas dock fits its column and is centred under the canvas
// Plus behaviour: template switch, zoom, export menu, layer selection, phone sheets.
// Run: node scripts/check-editor-ui.mjs   (skips if Chrome isn't installed)
//      EDUI_ONLY=1440:light:instagram  to narrow; EDUI_VERBOSE=1 for warnings.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.env.EDUI_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
if (!CHROME) { console.log('editor ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('editor ui: skipped (needs Node with WebSocket)'); process.exit(0); }

const WIDTHS = [1440, 1024, 375];
const THEMES = ['light', 'dark'];
const WORKSPACES = ['instagram', 'youtube', 'newsletter'];
// Off-grid spacing is reported every run; the run fails only if it grows past
// this many distinct offenders (lower it as legacy values get fixed).
const OFF_GRID_BASELINE = Number(process.env.EDUI_OFFGRID_BASELINE || 103);
const ONLY = (process.env.EDUI_ONLY || '').split(':').filter(Boolean);
const VERBOSE = Boolean(process.env.EDUI_VERBOSE);

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-edui-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const cdpPort = new URL(wsUrl).port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };

async function openTab() {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 200));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|Failed to load resource/.test(m.params.entry.text)) errors.push('log: ' + m.params.entry.text.slice(0, 200));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/frameup_usage_events*'] }); // tests never write usage rows to production
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return { ws, send, evaluate, errors, targetId: t.id };
}

// A fake, unexpired, unsigned session: only the page's own gate reads it (APIs are stubbed).
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const email='qa@essentiallysports.com'; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email,exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email,aud:'authenticated',role:'authenticated'}}));
  let h=0x811c9dc5; for (const ch of email) { h^=ch.codePointAt(0); h=Math.imul(h,0x01000193)>>>0; }
  const never=JSON.stringify({welcome:'never'}); localStorage.setItem('frameup.tours.v1:u'+h.toString(36), never); localStorage.setItem('frameup.tours.v1:device', never); sessionStorage.setItem('frameup.tours.offered','1'); return true; })()`;

// ── In-page audit (one string, evaluated per state) ─────────────────────
const AUDIT = String.raw`(() => {
  if (window.__eduiAudit) return true;
  // Some editor rows render in shadow DOM: walk up and down through it.
  const up = a => a.parentElement || (a.getRootNode && a.getRootNode() !== document && a.getRootNode().host) || null;
  const deepAll = root => { const out = []; const walk = n => { for (const e of n.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } }; walk(root); return out; };
  const within = (box, e) => { for (let a = e; a; a = up(a)) if (a === box) return true; return false; };
  const vis = e => { if (!e || !e.isConnected) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const visDeep = e => { for (let a = e; a && a !== document.documentElement; a = up(a)) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; if (a.hidden) return false; } const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const hasBox = e => { const s = getComputedStyle(e); return parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderLeftWidth) >= 1 && parseFloat(s.borderRightWidth) >= 1 && parseFloat(s.borderBottomWidth) >= 1 && s.borderTopStyle !== 'none' && parseRGBA(s.borderTopColor)[3] > 0.05; };
  const parseRGBA = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const name = e => { const id = e.id ? '#' + e.id : ''; const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24); return e.tagName.toLowerCase() + id + cls + (t ? ' "' + t + '"' : ''); };
  const EXCLUDE = '#preview, canvas, .es-sidebar, .fu-tour-toast, .fu-offer, #infographic-fields, #listicle-type2-fields, .es-toast, [data-qa-ignore]';
  const excluded = e => Boolean(e.closest(EXCLUDE));
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  function bgOf(e) { // effective background behind e; null when an image/gradient makes it unknowable
    const layers = [];
    for (let a = e; a; a = up(a)) {
      const s = getComputedStyle(a);
      const cv = a.classList && a.classList.contains('canvas-wrap') && a.querySelector(':scope > canvas#preview');
      if (cv && !(parseRGBA(s.backgroundColor)[3] >= 0.99)) { // text over the artwork: sample the canvas under it
        try { const er = e.getBoundingClientRect(), cr = cv.getBoundingClientRect(); const x = Math.round((er.left + er.width / 2 - cr.left) * cv.width / cr.width), y = Math.round((er.top + er.height / 2 - cr.top) * cv.height / cr.height); const d = cv.getContext('2d').getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data; layers.push([d[0], d[1], d[2], 1]); } catch { return null; }
        break;
      }
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      if (a.matches && a.matches('canvas, img, video')) return null;
      const c = parseRGBA(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    let out = [255, 255, 255, 1];
    if (!layers.length || layers[layers.length - 1][3] < 0.99) out = document.documentElement.getAttribute('data-theme') === 'dark' ? [14, 16, 20, 1] : [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  }
  const hue = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return { h: 0, s: 0, l: (mx + mn) / 2 }; const l = (mx + mn) / 2; const s = d / (1 - Math.abs(2 * l - 1)); let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; return { h, s, l }; };
  const purple = c => { if (c[3] < 0.2) return false; const { h, s, l } = hue(c); return h >= 255 && h <= 320 && s > 0.3 && l > 0.15 && l < 0.85; };
  const ES_FONT = /^["']?(acumin|roboto|roboto condensed|es-|essentially)/i;
  const MONO_OK = /^(kbd|code|pre|samp)$/i;
  const directText = e => { let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); };
  const textRect = e => { const r = document.createRange(); let box = null; for (const n of e.childNodes) { if (n.nodeType !== 3 || !n.nodeValue.trim()) continue; r.selectNodeContents(n); for (const q of r.getClientRects()) { if (!q.width) continue; box = box ? { left: Math.min(box.left, q.left), right: Math.max(box.right, q.right), top: Math.min(box.top, q.top), bottom: Math.max(box.bottom, q.bottom) } : { left: q.left, right: q.right, top: q.top, bottom: q.bottom }; } } return box; };
  const accName = e => {
    const lb = e.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    const al = (e.getAttribute('aria-label') || '').trim(); if (al) return al;
    if (e.labels && e.labels.length) { const t = [...e.labels].map(l => l.textContent).join(' ').trim(); if (t) return t; }
    const t = (e.textContent || '').trim(); if (t && !/^(input|select|textarea)$/i.test(e.tagName)) return t;
    const title = (e.getAttribute('title') || '').trim(); if (title) return title;
    const img = e.querySelector && e.querySelector('img[alt]:not([alt=""]), svg title'); if (img) return img.getAttribute('alt') || img.textContent;
    if (/^(input|textarea)$/i.test(e.tagName) && (e.placeholder || '').trim()) return e.placeholder;
    if (e.closest('label')) return e.closest('label').textContent.trim();
    return '';
  };

  window.__eduiAudit = function audit(opts = {}) {
    const issues = []; const warn = [];
    const add = (cls, msg) => issues.push(cls + ': ' + msg);
    const vw = innerWidth, vh = innerHeight;
    const roots = [...document.querySelectorAll(opts.roots || '.app[data-workspace], .es-topbar, .mobile-editor-topbar, .mobile-editor-nav, .studio-export-menu, .es-menu, [role=menu], [role=dialog], [role=listbox]')].filter(visDeep).filter(r => !excluded(r));
    const all = [];
    const seen = new Set();
    for (const r of roots) for (const e of [r, ...deepAll(r)]) { if (seen.has(e)) continue; seen.add(e); if (!excluded(e) && vis(e)) all.push(e); }
    const shown = all.filter(e => visDeep(e));
    const inView = e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };

    // 4. Horizontal page scroll (and a horizontally scrolling inspector).
    const se = document.scrollingElement;
    if (se.scrollWidth > vw + 1) add('page-scroll-x', 'page is ' + se.scrollWidth + 'px wide at ' + vw);
    const panel = document.querySelector('.app[data-workspace] > .panel');
    if (panel && vis(panel)) { const ps = getComputedStyle(panel); if (ps.overflowX !== 'hidden' && ps.overflowX !== 'clip' && panel.scrollWidth > panel.clientWidth + 1) add('page-scroll-x', 'inspector scrolls sideways (' + panel.scrollWidth + ' > ' + panel.clientWidth + ')'); }

    for (const e of shown) {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const tag = e.tagName;
      const isCtl = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !/^(hidden|checkbox|radio|range|color|file)$/.test(e.type);
      // 1. Doubled borders.
      if ((isCtl || e.matches('.select-dropdown-trigger, [role=combobox]')) && hasBox(e) && s.borderTopStyle !== 'none') {
        let a = up(e);
        for (let d = 0; d < 3 && a && !a.matches('.panel, body'); d++, a = up(a)) {
          if (vis(a) && hasBox(a)) { const ra = a.getBoundingClientRect(); if (ra.height < r.height + 24 && ra.width < r.width + 60) { add('doubled-border', name(e) + ' inside ' + name(a)); break; } }
        }
      }
      // 10. Broken images.
      if (tag === 'IMG' && e.getAttribute('src') && e.complete && e.naturalWidth === 0) add('broken-image', (e.getAttribute('src') || '').slice(0, 80));
      // 8. Unlabelled interactive elements.
      if ((e.matches('button, a[href], select, textarea, [role=button], [role=switch], [role=tab], [role=checkbox], [role=radio], [role=menuitem], [role=option]') || (tag === 'INPUT' && !/^(hidden)$/.test(e.type))) && !e.closest('[aria-hidden=true]') && e.getAttribute('tabindex') !== '-1') {
        if (!accName(e)) add('unlabelled', name(e) + ' has no accessible name');
      }
      // 7. Fonts and purple (UI chrome only).
      const text = directText(e);
      const textual = text || (isCtl && (e.value || '').trim());
      if (textual) {
        const fam = s.fontFamily.split(',')[0].trim();
        if (!ES_FONT.test(fam) && !(MONO_OK.test(tag) || /mono/i.test(fam))) add('font', name(e) + ' uses ' + fam);
      }
      if (!e.closest('[style*=background], [class*=swatch], [class*=color-chip], [class*=colour], [class*=logo], .team-color, svg')) {
        if (textual && purple(parseRGBA(s.color))) add('purple', name(e) + ' text ' + s.color);
        if (!e.hasAttribute('style') && purple(parseRGBA(s.backgroundColor))) add('purple', name(e) + ' background ' + s.backgroundColor);
        if (parseFloat(s.borderTopWidth) >= 1 && purple(parseRGBA(s.borderTopColor))) add('purple', name(e) + ' border ' + s.borderTopColor);
      }
      // 11. Contrast (disabled controls and placeholder-only fields are exempt).
      if (textual && inView(e) && !e.closest(':disabled, [aria-disabled=true], .is-disabled, [inert]')) {
        let op = 1; for (let a = e; a; a = up(a)) op *= +getComputedStyle(a).opacity;
        const bg = bgOf(e);
        if (bg && op > 0.95) {
          const fg = blend(parseRGBA(s.color), bg);
          const size = parseFloat(s.fontSize); const bold = +s.fontWeight >= 700;
          const large = size >= 24 || (bold && size >= 18.66);
          const need = large ? 3 : 4.5;
          const cr = ratio(fg, bg);
          if (cr + 0.01 < need) add('contrast', name(e) + ' ' + cr.toFixed(2) + ':1 (needs ' + need + ')');
        }
      }
      // 3. Clipped text.
      if (text && !e.closest('[aria-hidden=true]')) {
        const ell = el => getComputedStyle(el).textOverflow === 'ellipsis' || +getComputedStyle(el).webkitLineClamp > 0 || /line-clamp|ellipsis|truncate/.test(el.className);
        const ox = s.overflowX, oy = s.overflowY;
        if ((ox === 'hidden' || ox === 'clip') && e.scrollWidth > e.clientWidth + 1 && !ell(e)) add('clipped-text', name(e) + ' cut off horizontally (' + e.scrollWidth + ' > ' + e.clientWidth + ')');
        else if ((oy === 'hidden' || oy === 'clip') && e.scrollHeight > e.clientHeight + 2 && !ell(e) && e.clientHeight > 0) add('clipped-text', name(e) + ' cut off vertically (' + e.scrollHeight + ' > ' + e.clientHeight + ')');
        else {
          const tr = textRect(e);
          if (tr) for (let a = up(e), d = 0; a && d < 6 && !a.matches('body'); a = up(a), d++) {
            const as = getComputedStyle(a);
            if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
            if (/auto|scroll/.test(as.overflowX + as.overflowY)) break; // scrollable areas are fine
            const ar = a.getBoundingClientRect();
            if ((tr.right > ar.right + 1 || tr.left < ar.left - 1 || tr.bottom > ar.bottom + 2) && !ell(a) && !ell(e)) { add('clipped-text', name(e) + ' cut by ' + name(a)); }
            break;
          }
        }
      }
      // 6. Off-grid spacing (reported; baseline-gated).
      const sp = [];
      for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) sp.push(parseFloat(s[p]));
      if (/flex|grid/.test(s.display)) { const rg = parseFloat(s.rowGap), cg = parseFloat(s.columnGap); if (!Number.isNaN(rg)) sp.push(rg); if (!Number.isNaN(cg)) sp.push(cg); }
      const off = sp.filter(v => v > 2.5 && Math.abs(v - Math.round(v / 4) * 4) > 0.6);
      if (off.length && !isCtl) warn.push('off-grid: ' + name(e).replace(/ ".*$/, '') + ' ' + [...new Set(off.map(v => Math.round(v * 10) / 10))].join('/') + 'px');
    }

    // 3a. Selection / focus rings cut off by a clipping parent.
    for (const e of shown) {
      const s = getComputedStyle(e);
      if (s.outlineStyle === 'none' || !(parseFloat(s.outlineWidth) > 0)) continue;
      const grow = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset) || 0);
      const r = e.getBoundingClientRect();
      for (let a = up(e); a && a !== document.body; a = up(a)) {
        const as = getComputedStyle(a);
        if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
        const m = as.overflowX === 'clip' || as.overflowY === 'clip' ? parseFloat(as.overflowClipMargin) || 0 : 0;
        const ar0 = a.getBoundingClientRect(); const ar = { left: ar0.left - m, right: ar0.right + m, top: ar0.top - m, bottom: ar0.bottom + m };
        const bx = /visible/.test(as.overflowX) ? 0 : 1, by = /visible/.test(as.overflowY) ? 0 : 1;
        if ((bx && (r.left - grow < ar.left - 0.5 || r.right + grow > ar.right + 0.5)) || (by && (r.top - grow < ar.top - 0.5 && r.top >= ar.top || r.bottom + grow > ar.bottom + 0.5 && r.bottom <= ar.bottom))) add('clipped-ring', name(e) + ' ring cut by ' + name(a));
        break;
      }
    }

    // 3b. Controls escaping their bordered container (the dock pill bug).
    for (const e of shown.filter(x => x.matches('button, input, select, .es-btn'))) {
      const r = e.getBoundingClientRect();
      let a = up(e);
      for (let d = 0; d < 4 && a && !a.matches('.panel, body, .app'); d++, a = up(a)) {
        if (!vis(a) || !hasBox(a)) continue;
        const ar = a.getBoundingClientRect();
        if (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1) add('overflow', name(e) + ' spills out of ' + name(a));
        break;
      }
    }

    // 3c. Controls drawn on top of other controls (e.g. the canvas bar under
    // Export). Menus, drawers, popovers and the phone sheet / tab bar are meant
    // to cover things.
    const ctls = shown.filter(e => e.matches('button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=switch]') && inView(e)).map(e => [e, e.getBoundingClientRect()]);
    const overlayish = e => { for (let a = e; a; a = up(a)) { if (a.matches && a.matches('.layers-panel, .mobile-editor-nav, body.is-mobile-sheet-open .app > .panel, [role=menu], [role=dialog], [role=listbox], [class*=popover], [class*=menu], [class*=dropdown], [class*=tooltip], .fu-tour-toast')) return true; } return false; };
    for (let i = 0; i < ctls.length; i++) for (let j = i + 1; j < ctls.length; j++) {
      const [a, ra] = ctls[i], [b, rb] = ctls[j];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w < 4 || h < 4 || within(a, b) || within(b, a)) continue;
      const top = document.elementFromPoint(Math.max(ra.left, rb.left) + w / 2, Math.max(ra.top, rb.top) + h / 2);
      if (!top || overlayish(top)) continue;
      let stuck = false; for (let x = top; x && !stuck; x = up(x)) stuck = getComputedStyle(x).position === 'sticky'; // content scrolling under a sticky header
      if (stuck) continue;
      add('overlap', name(a) + ' and ' + name(b) + ' overlap (' + Math.round(w) + 'x' + Math.round(h) + 'px)');
    }

    // 5. Misaligned siblings.
    const rows = new Map();
    for (const e of shown) {
      const p = e.parentElement; if (!p) continue;
      const ps = getComputedStyle(p);
      if (!/flex|grid/.test(ps.display) || ps.flexDirection.startsWith('column') && !/grid/.test(ps.display)) continue;
      if (!rows.has(p)) rows.set(p, []);
      rows.get(p).push(e);
    }
    for (const [p, kids] of rows) {
      const btns = kids.filter(k => k.matches('button:not([role=switch]):not([role=tab]):not([role=radio]):not(.carousel-slide-button), .es-btn') && !k.closest('.studio-zoom-group'));
      const cards = kids.filter(k => typeof k.className === 'string' && k.className.split(/\s+/).some(t => /(^|-)(card|tile|option)s?$/.test(t)) && !k.matches('button, span'));
      for (const group of [btns, cards]) {
        if (group.length < 2) continue;
        const byRow = [];
        for (const k of group) { const r = k.getBoundingClientRect(); const row = byRow.find(x => Math.abs(x.top - r.top) < 2); if (row) row.items.push([k, r]); else byRow.push({ top: r.top, items: [[k, r]] }); }
        for (const row of byRow) {
          if (row.items.length < 2) continue;
          const hs = row.items.map(([, r]) => r.height);
          if (Math.max(...hs) - Math.min(...hs) > 1.5) add('misaligned', 'row in ' + name(p) + ': ' + row.items.map(([k, r]) => name(k) + '=' + Math.round(r.height)).join(', '));
        }
      }
    }

    // 2. Empty bands: open sections with no content, and gaps between dividers.
    const isContent = e => { if (e.matches('img, svg, canvas, video, input, select, textarea, button, [role=switch], hr')) return true; if (directText(e)) return true; if (hasBox(e)) return true; const s = getComputedStyle(e); if (parseRGBA(s.backgroundColor)[3] > 0.05 && e.getBoundingClientRect().height > 2) return true; return false; };
    const sections = shown.filter(e => e.matches('.studio-accordion-section, .studio-dock-section, .fi-section, .studio-accordion-collapse, [class*=-section]:not(button):not(span), [class*=-card]:not(button):not(span)') && e.closest('.panel, .layers-panel'));
    for (const sec of sections) {
      const r = sec.getBoundingClientRect(); if (r.height < 12) continue;
      if (sec.matches('.studio-accordion-collapse') && sec.parentElement?.querySelector('[aria-expanded=false]')) continue;
      const content = deepAll(sec).filter(k => vis(k) && visDeep(k) && !k.matches('.fi-section-title, .studio-accordion-trigger, .studio-accordion-trigger *, [class*=section-title], [class*=section-title] *, [class*=section-head], [class*=section-head] *') && isContent(k));
      if (!content.length && !hasBox(sec) && !directText(sec)) add('empty-band', name(sec) + ' (' + Math.round(r.height) + 'px) has nothing in it');
    }
    if (panel && vis(panel)) {
      const pr = panel.getBoundingClientRect();
      const lines = [];
      const floating = e => { for (let a = e; a && a !== panel; a = up(a)) { const ps = getComputedStyle(a).position; if (ps === 'absolute' || ps === 'fixed') return true; } return false; };
      for (const e of shown) {
        if (!within(panel, e) || floating(e)) continue;
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        if (r.width < pr.width * 0.6) continue;
        if (parseFloat(s.borderTopWidth) >= 1 && s.borderTopStyle !== 'none' && parseRGBA(s.borderTopColor)[3] > 0.05 && !hasBox(e)) lines.push([r.top, e]);
        if (parseFloat(s.borderBottomWidth) >= 1 && s.borderBottomStyle !== 'none' && parseRGBA(s.borderBottomColor)[3] > 0.05 && !hasBox(e)) lines.push([r.bottom, e]);
        if (e.tagName === 'HR') lines.push([r.top, e]);
      }
      lines.sort((a, b) => a[0] - b[0]);
      // Excluded blocks (the owner's WIP fields) are still content here.
      const leaves = deepAll(panel).filter(e => vis(e) && visDeep(e) && !floating(e) && (isContent(e) || e.matches('input, select, textarea, button, img, svg'))).map(e => e.getBoundingClientRect());
      for (let i = 1; i < lines.length; i++) {
        const [y0, a] = lines[i - 1], [y1, b] = lines[i];
        if (y1 - y0 < 1) continue;
        if (y1 > pr.bottom || y0 < pr.top) continue;
        const has = leaves.some(q => q.bottom > y0 + 1 && q.top < y1 - 1 && q.height < (y1 - y0) + 40);
        if (!has && y1 - y0 > 6) add('empty-band', Math.round(y1 - y0) + 'px empty band between ' + name(a) + ' and ' + name(b));
      }
    }

    // 8b. One primary button per view.
    // "Primary" = what renders as one: the spinning blue rim (design-tokens.css), or a filled brand-blue button.
    const looksPrimary = e => { const s = getComputedStyle(e); if (/conic-gradient/.test(s.backgroundImage)) return true; const c = parseRGBA(s.backgroundColor); const h = hue(c); return c[3] > 0.9 && h.h > 200 && h.h < 225 && h.s > 0.7 && h.l > 0.35 && h.l < 0.6 && lum(parseRGBA(s.color)) > 0.8; };
    const primaries = shown.filter(e => e.matches('button, a, [role=button]') && inView(e) && !e.closest('.fu-tour-toast, .fu-offer, [class*=swatch], [role=tablist], [role=radiogroup], .carousel-slide-switcher') && e.getAttribute('aria-pressed') !== 'true' && e.getAttribute('aria-selected') !== 'true' && !e.classList.contains('is-active') && looksPrimary(e));
    if (primaries.length > 1) add('primary', primaries.length + ' primary buttons in view: ' + primaries.map(name).join(', '));

    // Dock: fits the canvas column and sits centred under the canvas.
    const dock = document.querySelector('.canvas-stack > .canvas-bottom-actions');
    const canvas = document.querySelector('#preview');
    if (dock && vis(dock) && canvas && vis(canvas) && vw > 900) {
      const dr = dock.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      const col = document.querySelector('.app[data-workspace] > .canvas-panel')?.getBoundingClientRect();
      if (Math.abs((dr.left + dr.right) / 2 - (cr.left + cr.right) / 2) > 2) add('dock', 'dock centre ' + Math.round((dr.left + dr.right) / 2) + ' vs canvas centre ' + Math.round((cr.left + cr.right) / 2));
      if (col && (dr.left < col.left - 1 || dr.right > col.right + 1)) add('dock', 'dock ' + Math.round(dr.left) + '..' + Math.round(dr.right) + ' outside its column ' + Math.round(col.left) + '..' + Math.round(col.right));
      for (const k of dock.querySelectorAll('button')) { if (!vis(k) || !visDeep(k)) continue; const kr = k.getBoundingClientRect(); if (kr.left < dr.left - 1 || kr.right > dr.right + 1 || kr.top < dr.top - 1 || kr.bottom > dr.bottom + 1) { add('dock', name(k) + ' outside the dock'); } }
    }
    return { issues: [...new Set(issues)], warn: [...new Set(warn)] };
  };
  return true;
})()`;

// ── Per-state driver (in page) ──────────────────────────────────────────
const DRIVER = String.raw`(() => {
  if (window.__eduiDrive) return true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = e => e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const idle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
  const picker = () => ['#instagram-post-type-select', '#youtube-variation-select', '#newsletter-asset-select'].map(q => document.querySelector(q)).find(s => s && document.body.dataset.currentPage && s.closest('.panel'));
  const pickerFor = ws => document.querySelector({ instagram: '#instagram-post-type-select', youtube: '#youtube-variation-select', newsletter: '#newsletter-asset-select' }[ws]);
  const auditTwice = async (opts) => { let r = window.__eduiAudit(opts); if (r.issues.length) { await sleep(700); r = window.__eduiAudit(opts); } return r; };
  const openAll = async () => { for (const t of [...document.querySelectorAll('.app[data-workspace] > .panel .studio-accordion-trigger[aria-expanded=false]')].filter(vis)) { t.click(); } await idle(); };
  window.__eduiDrive = {
    async templates(ws) { const s = pickerFor(ws); return s ? [...s.options].filter(o => !o.disabled && !o.hidden).map(o => o.value) : ['']; },
    async desktop(ws, value, extras) {
      const out = {}; const s = pickerFor(ws); const behave = [];
      if (s && value !== undefined && s.value !== value) {
        s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); await sleep(450);
        if (s.selectedIndex >= 0 && s.options[s.selectedIndex].value !== value) behave.push('template ' + value + ' did not stick');
      }
      await openAll(); await sleep(150);
      out.template = await auditTwice();
      if (extras) {
        // A layer selected: the inspector jumps to that layer's settings.
        const row = [...document.querySelectorAll('#layers-panel-list [data-layer-id], #layers-panel-list .fu-layer-row, #layers-panel-list li')].find(vis);
        const head = () => (document.querySelector('.app[data-workspace] > .panel [class*=selection]')?.textContent || '').replace(/\s+/g, ' ').trim();
        if (row) { const label = (row.querySelector('strong')?.textContent || '').trim(); row.click(); await sleep(350); if (label && head() && !head().includes(label)) behave.push('selecting layer ' + label + ' left the inspector header at "' + head().slice(0, 40) + '"'); out.layer = await auditTwice(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150); }
      }
      if (extras === 'full') {
        // Export menu.
        const exp = document.querySelector('.studio-export-options-btn');
        if (exp && vis(exp)) {
          exp.click(); await sleep(350);
          if (exp.getAttribute('aria-expanded') !== 'true') behave.push('export options button did not open its menu');
          out.exportMenu = await auditTwice();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
          if (exp.getAttribute('aria-expanded') === 'true') { exp.click(); await sleep(200); }
        }
        // Zoom in / out actually changes the zoom readout.
        const zv = document.querySelector('.canvas-stack .studio-zoom-value');
        const zin = [...document.querySelectorAll('.canvas-stack .studio-zoom-btn')].find(b => /zoom in/i.test(b.getAttribute('aria-label') || b.title || ''));
        if (zv && zin && vis(zin)) { const a = zv.textContent.trim(); zin.click(); await sleep(250); const b = zv.textContent.trim(); if (a === b) behave.push('zoom in did not change ' + a); zv.click(); await sleep(200); }
        // Dock search open (the field replaces the image buttons).
        const pool = [...document.querySelectorAll('.canvas-stack .canvas-upload-button')].find(b => /image pool/i.test(b.textContent));
        if (pool && vis(pool)) { pool.click(); await sleep(450); out.dockSearch = await auditTwice(); const close = document.querySelector('.canvas-ai-search-close'); if (close && vis(close)) { close.click(); await sleep(300); } else { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300); } }
        // Layers column toggled the other way.
        const lc = document.querySelector('[data-layers-collapse]');
        if (lc && vis(lc)) { lc.click(); await sleep(500); out.layersToggled = await auditTwice(); lc.click(); await sleep(400); }
      }
      out.behave = behave;
      return out;
    },
    async phone(ws, value) {
      const out = {}; const s = pickerFor(ws); const behave = [];
      if (s && value !== undefined && s.value !== value) { s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); await sleep(450); }
      out.canvas = await auditTwice();
      const triggers = [...document.querySelectorAll('[data-mobile-editor-trigger]')].filter(vis);
      for (const t of triggers) {
        const key = t.dataset.mobileEditorTrigger;
        t.click(); await sleep(450);
        if (!document.body.classList.contains('is-mobile-sheet-open') || document.body.dataset.mobileEditorPanel !== key) behave.push('sheet ' + key + ' did not open');
        await openAll(); await sleep(120);
        out['sheet:' + key] = await auditTwice();
        // An open sheet must offer something: controls, or a plain note saying why not.
        const panelEl = document.querySelector('.app[data-workspace] > .panel');
        const sheetBody = panelEl ? [...panelEl.querySelectorAll('input:not([type=hidden]), select, textarea, button, img, .mobile-editor-empty')].filter(e => vis(e) && !e.closest('.mobile-editor-sheet-head') && e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 0) : [];
        if (!sheetBody.length) out['sheet:' + key].issues.push('empty-band: the ' + key + ' sheet opens with nothing in it');
        t.click(); await sleep(350);
        if (document.body.classList.contains('is-mobile-sheet-open')) behave.push('sheet ' + key + ' did not close on a second tap');
      }
      out.behave = behave;
      return out;
    },
  };
  return true;
})()`;

async function bootTab(tab, width, theme, ws) {
  const height = width < 768 ? 812 : 900;
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  if (width < 768) await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await tab.send('Page.navigate', { url: `${base}/__blank` });
  for (let i = 0; i < 40 && (await tab.evaluate('location.href').catch(() => '')) !== `${base}/__blank`; i++) await sleep(150);
  await tab.evaluate(SESSION);
  await tab.evaluate(`(() => { try { localStorage.setItem('frameup.theme', ${JSON.stringify(theme)}); localStorage.setItem('es-theme', ${JSON.stringify(theme)}); } catch {} return 1; })()`);
  await tab.send('Page.navigate', { url: `${base}/index.html#${ws}` });
  for (let i = 0; i < 60; i++) { await sleep(400); const ok = await tab.evaluate("Boolean(document.querySelector('.app[data-workspace] > .panel')) && document.documentElement.style.visibility !== 'hidden' && Boolean(window.FrameUpEditorUI?.ready)").catch(() => false); if (ok) break; }
  const where = await tab.evaluate('location.pathname + location.hash');
  if (/login/.test(where)) throw new Error('page went to ' + where + ' (sign-in gate)');
  await tab.evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
  await sleep(900);
  await tab.evaluate(AUDIT); await tab.evaluate(DRIVER);
  await tab.evaluate(`document.querySelectorAll('.fu-tour-toast, .fu-offer').forEach(n => n.remove()), 1`);
}

const failures = []; const offGrid = new Map(); let states = 0;
async function runCombo(width, theme) {
  const tab = await openTab();
  try {
    for (const ws of WORKSPACES) {
      if (ONLY[2] && ONLY[2] !== ws) continue;
      await bootTab(tab, width, theme, ws);
      const values = await tab.evaluate(`window.__eduiDrive.templates(${JSON.stringify(ws)})`);
      for (const [i, v] of values.entries()) {
        const fn = width < 768 ? `window.__eduiDrive.phone(${JSON.stringify(ws)}, ${JSON.stringify(v)})` : `window.__eduiDrive.desktop(${JSON.stringify(ws)}, ${JSON.stringify(v)}, ${JSON.stringify(i === 0 ? 'full' : width === 1440 ? 'layer' : '')})`;
        let res;
        try { res = await tab.evaluate(fn); } catch (err) { failures.push(`${width}/${theme}/${ws}/${v}: driver error ${err.message.slice(0, 200)}`); continue; }
        for (const [state, r] of Object.entries(res)) {
          if (state === 'behave') { for (const b of r) failures.push(`${width}/${theme}/${ws}/${v}: behaviour: ${b}`); continue; }
          states++;
          for (const m of r.issues) failures.push(`${width}/${theme}/${ws}/${v}/${state}: ${m}`);
          for (const w of r.warn) { const k = w; if (!offGrid.has(k)) offGrid.set(k, `${width}/${theme}/${ws}/${v}/${state}`); }
        }
        await tab.evaluate(`document.querySelectorAll('.fu-tour-toast, .fu-offer').forEach(n => n.remove()), 1`);
      }
      for (const e of tab.errors.splice(0)) failures.push(`${width}/${theme}/${ws}: ${e}`);
    }
  } finally {
    tab.ws.close();
    await fetch(`http://127.0.0.1:${cdpPort}/json/close/${tab.targetId}`).catch(() => {});
  }
}

// Debug one state: EDUI_PROBE='{"width":375,"theme":"dark","ws":"newsletter","value":"widgets","sheet":"content","shot":"/tmp/x.png"}'
if (process.env.EDUI_PROBE) {
  const p = JSON.parse(process.env.EDUI_PROBE);
  const tab = await openTab();
  await bootTab(tab, p.width || 1440, p.theme || 'light', p.ws || 'instagram');
  const r = await tab.evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const s = document.querySelector({ instagram: '#instagram-post-type-select', youtube: '#youtube-variation-select', newsletter: '#newsletter-asset-select' }[${JSON.stringify(p.ws || 'instagram')}]);
    if (s && ${JSON.stringify(p.value || '')}) { s.value = ${JSON.stringify(p.value || '')}; s.dispatchEvent(new Event('change', { bubbles: true })); await sleep(600); }
    for (const t of document.querySelectorAll('.app[data-workspace] > .panel .studio-accordion-trigger[aria-expanded=false]')) if (t.offsetParent) t.click();
    ${p.sheet ? `document.querySelector('[data-mobile-editor-trigger="${p.sheet}"]')?.click();` : ''}
    ${p.js || ''}
    await sleep(800); const a = window.__eduiAudit(); if (window.__probeOut) a.probe = window.__probeOut; return a; })()`);
  console.log(JSON.stringify(r, null, 1));
  if (p.shot) { const s = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(p.shot, Buffer.from(s.result.data, 'base64')); }
  for (const e of tab.errors) console.log(e);
  cleanup(); process.exit(0);
}

const started = Date.now();
const combos = [];
for (const w of WIDTHS) for (const t of THEMES) if ((!ONLY[0] || +ONLY[0] === w) && (!ONLY[1] || ONLY[1] === t)) combos.push([w, t]);
try {
  // One tab per width/theme combo, all at once, keeps the sweep near three minutes.
  const queue = [...combos];
  const lanes = Math.max(1, Number(process.env.EDUI_TABS || combos.length));
  await Promise.all(Array.from({ length: lanes }, async () => { while (queue.length) { const [w, t] = queue.shift(); await runCombo(w, t); } }));
} catch (err) {
  console.log('editor ui: ' + err.message); cleanup(); process.exit(1);
}
cleanup();

const uniq = [...new Set(failures)];
if (VERBOSE || uniq.length) for (const f of uniq) console.log('FAIL ' + f);
if (VERBOSE) for (const [k, where] of offGrid) console.log('WARN ' + k + '  (first at ' + where + ')');
const secs = Math.round((Date.now() - started) / 1000);
console.log(`editor ui: ${states} states swept in ${secs}s (${combos.length} width/theme combos); ${uniq.length} problem(s); ${offGrid.size} off-grid spacing value(s) (baseline ${OFF_GRID_BASELINE})`);
if (offGrid.size > OFF_GRID_BASELINE) { console.log('editor ui: off-grid spacing grew past the baseline; run with EDUI_VERBOSE=1 to list them'); process.exit(1); }
process.exit(uniq.length ? 1 : 0);
