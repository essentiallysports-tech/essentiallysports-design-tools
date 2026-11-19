// Generate UI sweep: every state of the Generate view in real headless Chrome,
// at 1440, 1024 and 375 wide, light and dark, with every /api/* stubbed (no AI,
// no Supabase, no network beyond fonts). States: idle (live trends), trends
// offline, a typed brief with ES templates, Bring it on-brand open, loading,
// Creative results (built by the real composer from a fixture brief), a card's
// photo and text panels, the focus view on each tab, an error notice, free
// mode, and a one-design result. Behaviour is checked on the way (each click
// does what it says). Each state fails on:
//   doubled borders, empty bands, clipped / overflowing text, horizontal page
//   scroll, misaligned cards / buttons in a row, non-ES fonts, purple in UI
//   chrome, unlabelled controls, more than one primary button per view,
//   console errors, broken images, contrast under 4.5:1 (3:1 large text).
// Off-grid spacing (not a multiple of 4) is reported, not failed.
// A failing state is re-checked once after a short settle.
// Run: node scripts/check-generate-ui.mjs   (skips if Chrome isn't installed)
//   QA_UI_SHOTS=<dir> saves a screenshot of every state.
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';
import { buildPlan, qaFile, proxiedPlan, qaProxyFile } from './_qa-generate-fixtures.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('generate ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('generate ui: skipped (needs Node with WebSocket)'); process.exit(0); }

const BRIEF = 'Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL';
const PLAN = await buildPlan(BRIEF, { want: 4 });
// gen v4: the server's design review (fixed while designing + creative ideas),
// with one repair the page must never offer, and several dated ES sources.
const REVIEW_FIRST = 'Try a versus layout: the Bills and the Chiefs side by side, with the 30-21 score between them as the one big number';
const REVIEW = {
  autoFixed: ['Brighter photo behind the headline', "Added Josh Allen's photo (he is named in the brief)", 'Restored the colon after ALLEN'],
  suggestions: [
    { text: 'Try a versus layout: the Bills and the Chiefs side by side, with the 30-21 score between them as the one big number' },
    { text: 'Lead with the 1000+ rushing yards as one giant number and let the cut-out break the frame' },
    { text: 'The NFL tag is tiny and the photo is murky' },
  ],
};
PLAN.directions.forEach(d => { d.review = JSON.parse(JSON.stringify(REVIEW)); });
PLAN.research = { articles: [
  { title: 'Josh Allen goes over 1,000 rushing yards as the Bills beat the Chiefs 30-21', url: 'https://www.essentiallysports.com/nfl-news-josh-allen-1000/', date: '2026-11-19' },
  { title: '"He is the MVP": Bills teammates react to a record night in Kansas City', url: 'https://www.essentiallysports.com/nfl-news-bills-react/', date: '2026-11-18' },
  { title: 'Chiefs fall to 7-4 after a second loss in three weeks at Arrowhead', url: 'https://www.essentiallysports.com/nfl-news-chiefs-7-4/', date: '2026-11-17' },
  { title: 'Josh Allen and the Bills: the numbers behind their best start since 1991', url: 'https://www.essentiallysports.com/nfl-news-bills-start/', date: '2026-11-04' },
] };
const PLAN_ONE = await buildPlan(BRIEF, { want: 1 });
// As production sends it: ES CDN photos through the proxy, no cut-out yet, no
// plan.imagery (the server never sends it), so the page makes the cut-outs.
const PLAN_LIVE = (() => { const p = proxiedPlan(PLAN); p.directions.forEach(d => { if (d.input) { d.input.cutout = null; d.input.cutouts = []; } d.cutout = null; }); delete p.imagery; return p; })();
const TRENDS = {
  categories: [{ id: 'nfl', label: 'NFL' }, { id: 'nba', label: 'NBA' }, { id: 'golf', label: 'Golf' }],
  items: [
    { title: 'Josh Allen leads the Bills past the Chiefs in a night of firsts', category: 'nfl', image: '/__qa/photo/josh-allen-1.svg', publishedAt: '2026-11-20T10:00:00Z' },
    { title: 'Shai Gilgeous-Alexander drops 40 as the Thunder stay perfect at home', category: 'nba', image: '', publishedAt: '2026-11-20T09:00:00Z' },
    { title: 'Scottie Scheffler confirms his schedule for the Hero World Challenge', category: 'golf', image: '/__qa/photo/scottie-scheffler-2.svg', publishedAt: '2026-11-20T08:00:00Z' },
    { title: 'Lakers weigh a trade for a third star before the deadline', category: 'nba', publishedAt: '2026-11-20T07:00:00Z' },
    { title: 'Arch Manning and Texas prepare for Georgia in a top-five clash', category: 'nfl', publishedAt: '2026-11-20T06:00:00Z' },
  ],
};

// What the stubs answer (changed per state).
const stub = { trends: 'ok', creative: 'ok', delay: 0, free: false, one: false, live: false, briefs: [] };
const api = (req, url, body) => {
  const p = url.pathname;
  if (p === '/api/es-image-search' && url.searchParams.get('image')) { const f = qaProxyFile(url); return f ? { type: f.type, body: f.body } : { status: 404, body: {} }; }
  // Cut-outs: the mask service is off here, so the page falls back to its own
  // plain-backdrop mask (or skips the cut-out); storing one just echoes it.
  if (p === '/api/gen-assets') return { body: body?.op === 'cutout' ? { ok: false, reason: 'off', cost: 0 } : body?.op === 'cutout-store' ? { ok: true, url: body.image } : { ok: true } };
  if (p === '/api/trend-design') return stub.trends === 'ok' ? { body: TRENDS } : { status: 503, body: { error: 'Trends are unavailable.' } };
  if (p === '/api/ai-status') {
    return { body: stub.free
      ? { ok: true, mode: 'free', reason: 'user-limit', notice: 'You have used this week\'s AI budget. FrameUp works without AI until Monday.', userLimitUsd: 20, userSpentUsd: 20, resetsAt: '2026-11-23T00:00:00Z', admin: false }
      : { ok: true, mode: 'ai', userLimitUsd: 20, userSpentUsd: 3.2, teamLimitUsd: 45, teamSpentUsd: 11.4, admin: false } };
  }
  if (p === '/api/es-generate' && req.method === 'GET') return { body: { roles: { trending: true } } };
  if (p === '/api/es-generate') {
    const mode = body?.mode || '';
    if (mode === 'creative') {
      stub.briefs.push(String(body?.brief || ''));
      if (stub.creative === 'limit') return { status: 429, body: { error: 'You have reached the hourly limit for Generate.', reason: 'hourly' } };
      return { body: JSON.parse(JSON.stringify(stub.live ? PLAN_LIVE : stub.one ? PLAN_ONE : PLAN)), delay: stub.delay };
    }
    if (mode === 'creative-judge') return { body: { directions: [], cost: 0, source: 'heuristic' } };
    if (mode === 'trending') return { body: { topics: ['Josh Allen MVP race', 'Thunder home streak'] } };
    if (mode === 'photos') return { body: { query: body.query, photos: [{ title: 'ES photo', url: '/__qa/photo/josh-allen-1.svg' }] } };
    return { body: { designs: [], runId: 'qa' } };
  }
  return null;
};

const { server, base } = await startServer({ api, extra: qaFile });
const chrome = await startChrome(CHROME);
const { send, evaluate, on } = chrome;
const errors = [];
on(m => {
  if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const e = m.params.entry;
    // Only this page's own requests count (blocked Supabase / font hosts do not).
    if (!e.url || e.url.startsWith(base)) errors.push('log: ' + e.text.slice(0, 200) + (e.url ? ` (${e.url.replace(base, '')})` : ''));
  }
});
const stop = () => { chrome.close(); server.close(); };

// ── The scanner (runs in the page) ─────────────────────────────────────────
const SCAN = `(() => {
  const issues = []; const grid = [];
  const dialog = [...document.querySelectorAll('.gfx')].find(e => e.offsetParent || getComputedStyle(e).position === 'fixed');
  const scope = (window.__qaScope && document.querySelector(window.__qaScope)) || (dialog && dialog.getBoundingClientRect().width > 0 ? dialog : document.querySelector('main#main'));
  const faded = e => { let op = 1; for (let a = e; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity); return op < 0.1; };
  // Visually hidden (screen-reader only) text: clipped to nothing on purpose.
  const srOnly = e => { for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); const r = a.getBoundingClientRect(); if ((s.position === 'absolute' || s.position === 'fixed') && r.width <= 2 && r.height <= 2) return true; if (/rect\\(0/.test(s.clip) || /inset\\(50%/.test(s.clipPath)) return true; } return false; };
  const closedDetails = e => { const d = e.closest('details:not([open])'); return Boolean(d && !e.closest('summary') && e !== d); };
  const vis = e => { if (!e || !e.isConnected) return false; if (e.closest('[hidden]') || closedDetails(e)) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5 && !faded(e) && !srOnly(e); };
  const name = e => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') || e.tagName.toLowerCase();
  const inDesign = e => Boolean(e.closest('canvas, .gen-cc__media, .gfx-stage, .gfx-canvas, .gen-thumb, .gen-trend__art'));
  const all = [...scope.querySelectorAll('*')].filter(vis);
  const rgb = c => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hasBox = e => { const s = getComputedStyle(e); return ['Top', 'Right', 'Bottom', 'Left'].filter(k => parseFloat(s['border' + k + 'Width']) >= 1 && s['border' + k + 'Style'] !== 'none' && (rgb(s['border' + k + 'Color'])?.a ?? 0) > 0.05).length >= 3; };
  // 1. Doubled borders.
  all.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, button, [role=button], .es-chip')).forEach(c => {
    if (!hasBox(c)) return; const rc = c.getBoundingClientRect();
    let a = c.parentElement;
    for (let d = 0; d < 3 && a && a !== scope; d++, a = a.parentElement) {
      if (!vis(a) || !hasBox(a)) continue; const ra = a.getBoundingClientRect();
      if (ra.width - rc.width < 14 && ra.height - rc.height < 14) { issues.push('doubled border: ' + name(c) + ' in ' + name(a)); break; }
    }
  });
  // 2. Empty bands: a visible block with nothing visible in it.
  const content = e => [...e.querySelectorAll('img, svg, canvas, video, input, textarea, select, button, [role=img]')].some(vis) || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || [...e.children].some(k => vis(k) && content(k));
  all.filter(e => e.matches('section, details, p, ul, ol, li, .ais-surface, .es-callout, [role=status], [role=alert], [role=list], [class*="card"], [class*="__panel"], [class*="__body"], [class*="-panel"]')).forEach(e => {
    const r = e.getBoundingClientRect(); if (r.height < 6 || e.getAttribute('aria-busy') === 'true' || e.closest('[aria-busy=true], .is-skeleton') || e.matches('.es-sr-only, .gen-sr')) return;
    if (!content(e)) issues.push('empty band: ' + name(e) + ' (' + Math.round(r.height) + 'px)');
  });
  // 3. Clipped / overflowing text.
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!n.textContent.trim() || !vis(el) || inDesign(el) || el.closest('.es-sr-only, .gen-sr, option, script, style')) continue;
    const range = document.createRange(); range.selectNodeContents(n); const rr = range.getBoundingClientRect(); if (!rr.width) continue;
    let a = el;
    while (a && a !== document.body) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        if (/auto|scroll/.test(s.overflowX + s.overflowY)) break;
        const ra = a.getBoundingClientRect();
        const ell = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || getComputedStyle(el).textOverflow === 'ellipsis';
        if (!ell && (rr.right > ra.right + 1.5 || rr.left < ra.left - 1.5 || rr.bottom > ra.bottom + 2 || rr.top < ra.top - 2)) issues.push('clipped text: "' + n.textContent.trim().slice(0, 30) + '" in ' + name(a));
        break;
      }
      a = a.parentElement;
    }
    const re = el.getBoundingClientRect();
    if (getComputedStyle(el).display !== 'inline' && rr.right > re.right + 2 && getComputedStyle(el).textOverflow !== 'ellipsis') issues.push('text overflows its box: "' + n.textContent.trim().slice(0, 30) + '" in ' + name(el));
  }
  // A choice row (segmented, tabs, radios, toolbar) that hides options off its edge.
  all.filter(e => e.matches('.es-segmented, [role=tablist], [role=radiogroup], [role=toolbar]') && !inDesign(e)).forEach(e => { if (e.scrollWidth > e.clientWidth + 1) issues.push('options cut off: ' + name(e) + ' (' + e.scrollWidth + ' > ' + e.clientWidth + ')'); });
  // 4. Horizontal page scroll.
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push('horizontal scroll: ' + document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth);
  // 5. Misaligned siblings: cards in a row of different heights, buttons in a row of different heights.
  const rows = new Map();
  all.forEach(e => {
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\\s+/)[0] : '';
    const card = /(^|-)card|gen-cc$|gen-trend$|gen-direction$|gen-slide$/.test(cls) && !/__/.test(cls);
    const btn = e.matches('button, .es-btn, [role=button]') && !inDesign(e) && !e.closest('.es-segmented, [role=tablist], [role=radiogroup], .gen-photos__strip');
    if (!card && !btn) return;
    // A card with a panel open (photos, text) is taller on purpose.
    if (card && e.querySelector('[aria-expanded="true"], details[open]')) return;
    const r = e.getBoundingClientRect();
    const key = (card ? 'card:' + cls : 'btn') + '|' + (e.parentElement ? [...e.parentElement.parentElement?.children || []].indexOf(e.parentElement) + ':' + name(e.parentElement) : '') + '|' + Math.round(r.top / 4);
    if (!rows.has(key)) rows.set(key, []); rows.get(key).push({ e, r, card, cls });
  });
  rows.forEach(list => {
    if (list.length < 2) return;
    const hs = list.map(x => x.r.height);
    if (Math.max(...hs) - Math.min(...hs) > (list[0].card ? 2 : 1.5)) issues.push('misaligned ' + (list[0].card ? 'cards ' + list[0].cls : 'buttons') + ': heights ' + [...new Set(hs.map(Math.round))].join('/') + ' in ' + name(list[0].e.parentElement));
    if (list[0].card) {
      const bars = list.map(x => x.e.querySelector('.gen-cc__bar, [role=toolbar]')).filter(Boolean).filter(vis).map(b => Math.round(b.getBoundingClientRect().top));
      if (bars.length > 1 && Math.max(...bars) - Math.min(...bars) > 2) issues.push('misaligned action rows: ' + [...new Set(bars)].join('/'));
    }
  });
  // 6. Off-grid spacing (reported only).
  all.forEach(e => {
    if (inDesign(e)) return; const s = getComputedStyle(e);
    ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap'].forEach(k => { const v = parseFloat(s[k]); if (v > 2 && Math.abs(v - Math.round(v / 4) * 4) > 0.5) grid.push(name(e) + ' ' + k + ' ' + v); });
  });
  // 7. Fonts and purple in UI chrome.
  all.forEach(e => {
    if (inDesign(e)) return; const s = getComputedStyle(e);
    if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (!/acumin|roboto|^system-ui$|^-apple-system$|monospace|menlo|sf mono|ui-monospace|courier/i.test(fam)) issues.push('font: ' + fam + ' on ' + name(e));
    }
    ['color', 'backgroundColor', 'borderTopColor'].forEach(k => {
      const c = rgb(s[k]); if (!c || c.a < 0.2) return;
      const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 0.18) return; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
      if (h >= 258 && h <= 300 && (k !== 'borderTopColor' || parseFloat(s.borderTopWidth) > 0)) issues.push('purple ' + k + ' ' + s[k] + ' on ' + name(e));
    });
  });
  // 8. Unlabelled controls; one primary button per view.
  all.filter(e => e.matches('button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=radio], [role=tab], [role=switch], [role=checkbox], [role=menuitem]')).forEach(e => {
    const lab = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join('').trim() || e.textContent.trim() || e.getAttribute('title') || e.querySelector('img[alt]')?.alt || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent.trim()) || e.closest('label')?.textContent.trim() || '';
    if (!lab) issues.push('unlabelled: ' + name(e));
  });
  const primaries = all.filter(e => e.matches('.es-btn--primary') && !e.disabled);
  if (primaries.length > 1) issues.push('primary buttons: ' + primaries.length + ' (' + primaries.map(name).join(', ') + ')');
  // 10. Broken images.
  all.filter(e => e.tagName === 'IMG' && e.complete && !e.naturalWidth).forEach(e => issues.push('broken image: ' + (e.getAttribute('src') || '').slice(0, 60)));
  // 11. Contrast (text on a known flat background).
  const bgOf = e => { let layers = []; for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.backgroundImage !== 'none' || ['IMG', 'CANVAS', 'VIDEO'].includes(a.tagName)) return null; const c = rgb(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; } } let base = { r: 255, g: 255, b: 255 }; if (!layers.length || layers[layers.length - 1].a < 0.99) base = document.documentElement.dataset.theme === 'dark' ? { r: 15, g: 17, b: 21 } : base; for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; } return base; };
  all.forEach(e => {
    if (inDesign(e) || e.closest('[disabled], [aria-disabled=true], .es-sr-only, .gen-sr, [aria-hidden=true]') || !([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))) return;
    const s = getComputedStyle(e); const fg = rgb(s.color); if (!fg) return; const bg = bgOf(e); if (!bg) return;
    let op = 1; for (let a = e; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
    const ink = { r: fg.r * fg.a * op + bg.r * (1 - fg.a * op), g: fg.g * fg.a * op + bg.g * (1 - fg.a * op), b: fg.b * fg.a * op + bg.b * (1 - fg.a * op) };
    const size = parseFloat(s.fontSize); const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const r = ratio(ink, bg);
    if (r < (large ? 3 : 4.5) - 0.02) issues.push('contrast ' + r.toFixed(2) + ':1 "' + e.textContent.trim().slice(0, 24) + '" on ' + name(e));
  });
  return { issues: [...new Set(issues)], grid: [...new Set(grid)] };
})()`;

const WIDTHS = [1440, 1024, 375];
const THEMES = ['light', 'dark'];
const results = [];
const gridAll = new Set();
const shots = process.env.QA_UI_SHOTS || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
async function setSize(w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 500 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 500 });
}
const EXPECTED = { 'trends-offline': /status of 503 .*\/api\/trend-design/, error: /status of 429 .*\/api\/es-generate/ };
let seenErrors = 0; // errors raised while reaching a state count against its first sweep
async function sweep(state) {
  for (const w of WIDTHS) {
    await setSize(w);
    for (const theme of THEMES) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await sleep(250);
      let r = await evaluate(SCAN);
      if (r.issues.length) { await sleep(900); r = await evaluate(SCAN); } // settle once
      // A state built on a failing stub expects that request's own failure line.
      const errs = errors.slice(seenErrors).filter(e => !(EXPECTED[state] && EXPECTED[state].test(e)));
      seenErrors = errors.length;
      const issues = [...r.issues, ...errs];
      r.grid.forEach(g => gridAll.add(g));
      results.push({ state, w, theme, issues });
      if (shots) {
        const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false });
        if (shot.result?.data) fs.writeFileSync(path.join(shots, `${state}-${w}-${theme}.jpg`), Buffer.from(shot.result.data, 'base64'));
      }
    }
  }
  await setSize(1440);
  await evaluate("document.documentElement.dataset.theme = 'light'");
}
const behaviour = [];
const expect = (ok, what) => { if (!ok) behaviour.push(what); };
const waitFor = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(150); } return false; };

async function open({ look = 'creative' } = {}) {
  await send('Page.navigate', { url: `${base}/__blank` });
  await waitFor(`location.pathname === '/__blank'`);
  await evaluate(FAKE_SESSION);
  await evaluate('sessionStorage.clear(), true'); // the AI status is cached per tab
  // The sidebar's AI usage card reads this week's spend (Supabase is blocked
  // here), so seed its per-tab cache: per-tool rows for the details popover.
  await evaluate(`(() => { const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); sessionStorage.setItem('frameup.aiUsage.v1', JSON.stringify({ at: Date.now(), since: start.toISOString(), data: { total_usd: 1.73, calls: 206, by_feature: { 'video-ads-copy': 1.06, 'generate-creative': 0.46, 'reels-plan': 0.21 } } })); return true; })()`);
  // The "New: tours" corner card belongs to the tours (another sweep); keep it off this page's states.
  await evaluate(`(() => { let h = 0x811c9dc5; for (const ch of 'qa@essentiallysports.com') { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } for (const k of ['frameup.tours.v1:u' + h.toString(36), 'frameup.tours.v1:device']) localStorage.setItem(k, JSON.stringify({ welcome: 'never' })); return true; })()`);
  await evaluate(`localStorage.setItem('frameup.generate.look.v1', ${JSON.stringify(look)}); localStorage.removeItem('frameup.generate.count.v1'); true`);
  await send('Page.navigate', { url: `${base}/generate.html` });
  const ok = await waitFor(`Boolean(window.FrameUpGenerate && window.FrameUpCreative && document.querySelector('#gen-look')) && document.readyState === 'complete'`, 25000);
  if (!ok) throw new Error('Generate did not load: ' + await evaluate('location.href'));
  await waitFor(`document.getElementById('gen-live')?.getAttribute('aria-busy') !== 'true'`, 8000);
  await sleep(400);
}
const typeBrief = text => evaluate(`(() => { const b = document.getElementById('gen-brief'); b.value = ${JSON.stringify(text)}; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

let exitCode = 0;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/*', '*://*.essentiallysports.com/*', '*vercel*', '*google-analytics*', '*googletagmanager*'] });
  const started = Date.now();

  // Idle, live trends.
  await open();
  if (/login/.test(await evaluate('location.pathname'))) throw new Error('sign-in gate: cannot sweep');
  expect(await evaluate(`document.querySelectorAll('#gen-live .gen-trend:not(.is-skeleton)').length === 3`), 'idle: three live trends');
  expect(await evaluate(`!document.getElementById('gen-trending').hidden`), 'idle: Suggest topics shows when ES MCP has a trending tool');
  await sweep('idle');

  // gen v4 #10: a live trend fills a real brief (no "Story:" / "Sport:" lines)
  // and Generate still sends the league to the server.
  stub.briefs = [];
  await evaluate(`document.querySelector('#gen-live .gen-trend:not(.is-skeleton)')?.click()`);
  await waitFor(`!window.FrameUpGenerate.isBusy() && document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length > 0`, 60000);
  const shown = await evaluate(`document.getElementById('gen-brief').value`);
  expect(!/^\s*(?:story|sport|team)\s*:/im.test(shown) && /Josh Allen/.test(shown), `hand-off: the brief box shows a real brief (got "${shown.slice(0, 80)}")`);
  expect(/\nSport: NFL$/.test(stub.briefs.at(-1) || ''), `hand-off: the league still reaches the server (sent "${(stub.briefs.at(-1) || '').slice(-40)}")`);
  expect(await evaluate(`!/Sport:/.test(JSON.parse(localStorage.getItem('frameup.generate.recent.v2') || '[]')[0]?.brief || '')`), 'hand-off: Recent keeps the brief as shown');

  // Trends offline.
  stub.trends = 'fail';
  await open();
  expect(await evaluate(`document.getElementById('gen-empty').classList.contains('is-offline')`), 'offline: the empty state says trends are offline');
  await sweep('trends-offline');
  stub.trends = 'ok';

  // A typed brief, ES templates look.
  await open({ look: 'templates' });
  await typeBrief(BRIEF);
  await sleep(500);
  expect(await evaluate(`document.querySelectorAll('#gen-found li').length > 0`), 'brief: found chips list who / numbers');
  expect(await evaluate(`document.querySelector('[data-look="templates"]').getAttribute('aria-checked') === 'true'`), 'brief: ES templates look is chosen');
  await sweep('brief-templates');

  // Bring it on-brand.
  await evaluate(`document.getElementById('gen-onbrand-open').click()`);
  await sleep(400);
  expect(await evaluate(`!document.getElementById('gen-onbrand').hidden && document.getElementById('gen-onbrand-open').getAttribute('aria-expanded') === 'true'`), 'on-brand: opens');
  expect(await evaluate(`document.getElementById('gen-onbrand-run').disabled`), 'on-brand: Check and remake waits for a slide');
  await sweep('onbrand-open');
  await evaluate(`document.getElementById('gen-onbrand-close').click()`);
  await sleep(300);
  expect(await evaluate(`document.getElementById('gen-onbrand').hidden`), 'on-brand: closes');

  // Creative: loading, then results.
  await open({ look: 'creative' });
  await typeBrief(BRIEF);
  await sleep(300);
  expect(await evaluate(`/~\\d+ s|~\\d+ min/.test(document.getElementById('gen-count-cost')?.textContent || '')`), 'eta: the time estimate shows before generating');
  stub.delay = 4000;
  await evaluate(`document.getElementById('gen-submit').click()`);
  await sleep(1200);
  expect(await evaluate(`document.querySelectorAll('#gen-grid .is-skeleton, #gen-grid [class*=skeleton]').length > 0 && !document.getElementById('gen-progress').hidden`), 'loading: skeletons and progress');
  expect(await evaluate(`/left|takes/i.test(document.querySelector('#gen-progress .gen-progress__left')?.textContent || '')`), 'eta: the live countdown shows while generating');
  await sweep('loading');
  stub.delay = 0;
  const made = await waitFor(`document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length >= 2 && !window.FrameUpGenerate.isBusy()`, 60000);
  expect(made, 'creative: designs arrive');
  expect(await evaluate(`!document.getElementById('gen-summary').hidden && /design/.test(document.getElementById('gen-summary').textContent)`), 'creative: summary line');
  await sleep(600);
  await sweep('results');
  // gen v4 #7: the sources card (the ES articles the facts came from).
  expect(await evaluate(`!document.getElementById('gen-research').hidden && !document.getElementById('gen-research').open && /4 ES stories/.test(document.getElementById('gen-research').textContent)`), 'sources: a collapsed card says how many ES stories');
  await evaluate(`document.querySelector('#gen-research summary').click()`);
  await sleep(300);
  expect(await evaluate(`document.getElementById('gen-research').open && document.querySelectorAll('#gen-research-list a[target=_blank]').length === 4 && /Nov 19/.test(document.querySelector('#gen-research-list li').textContent)`), 'sources: opens to dated links, newest first');
  await evaluate(`document.getElementById('gen-research').scrollIntoView({ block: 'center' }), true`);
  await sweep('sources-open');
  await evaluate(`document.getElementById('gen-research').open = false, true`);

  // Card panels: photos and text.
  await evaluate(`(() => { const c = document.querySelector('#gen-grid .gen-cc'); c.querySelector('[data-cc="photos"]')?.click(); c.querySelector('[data-cc="text"]')?.click(); return true; })()`);
  await sleep(500);
  expect(await evaluate(`(() => { const c = document.querySelector('#gen-grid .gen-cc'); const p = c.querySelector('.gen-cc__photos'), t = c.querySelector('.gen-cc__text'); return (!p || !p.hidden) && (!t || !t.hidden); })()`), 'card: Swap photo and Edit text open their panels');
  await sweep('card-panels');
  // The director's note open (What could be better, Apply).
  await evaluate(`(() => { document.querySelectorAll('#gen-grid .gen-cc').forEach(c => { c.querySelector('[data-cc="photos"][aria-expanded="true"]')?.click(); c.querySelector('[data-cc="text"][aria-expanded="true"]')?.click(); const d = c.querySelector('.gen-cc__director'); if (d) d.open = true; }); return true; })()`);
  await sleep(500);
  expect(await evaluate(`[...document.querySelectorAll('#gen-grid .gen-cc__director')].every(d => d.open)`), 'card: the director note opens');
  expect(await evaluate(`/Fixed while designing/.test(document.querySelector('#gen-grid .gen-cc__fixed:not([hidden])')?.textContent || '')`), 'review: cards say what was fixed while designing');
  expect(await evaluate(`![...document.querySelectorAll('#gen-grid .gen-cc__better li')].some(li => /murky|tag/i.test(li.textContent))`), 'review: a repair is never offered as an idea');
  await evaluate(`document.querySelector('#gen-grid .gen-cc__director')?.scrollIntoView({ block: 'center' }), true`);
  await sweep('director-open');
  await evaluate(`document.querySelectorAll('#gen-grid .gen-cc__director').forEach(d => { d.open = false; }), true`);
  // Try another composition changes the design.
  const before = await evaluate(`JSON.stringify(window.FrameUpCreative.designs()[0]?.scene?.() || window.FrameUpCreative.state.cards[0]?._scene || {}).length`);
  await evaluate(`document.querySelector('#gen-grid .gen-cc [data-cc="another"]')?.click()`);
  await sleep(1200);
  const after = await evaluate(`JSON.stringify(window.FrameUpCreative.state.cards[0]?._scene || {}).length`);
  expect(before !== after || await evaluate(`window.FrameUpCreative.state.cards[0]?._index > 0`), 'card: Try another composition moves to the next one');

  // Focus view, every tab.
  await evaluate(`document.querySelector('#gen-grid .gen-cc .gen-cc__media')?.click()`);
  expect(await waitFor(`Boolean([...document.querySelectorAll('.gfx')].find(e => e.getBoundingClientRect().width > 0))`, 5000), 'focus: opens on a design click');
  for (const tab of ['assistant', 'director', 'layers', 'history']) {
    await evaluate(`document.querySelector('.gfx [data-tab="${tab}"].gfx-tab')?.click()`);
    await sleep(500);
    expect(await evaluate(`document.querySelector('.gfx [data-tab="${tab}"].gfx-tab')?.getAttribute('aria-selected') === 'true'`), `focus: ${tab} tab selects`);
    if (tab === 'assistant') {
      await waitFor(`document.querySelectorAll('.gfx .fa-chat__chips .es-chip').length > 0`, 5000);
      const chips = await evaluate(`[...document.querySelectorAll('.gfx .fa-chat__chips .es-chip')].map(c => c.textContent.trim())`);
      expect(chips.length === 2 && chips[0] === REVIEW_FIRST, `focus: idea chips show the full text, creative only (got ${JSON.stringify(chips)})`);
      expect(await evaluate(`/Fixed while designing: Brighter photo/.test(document.querySelector('.gfx .fa-fixed:not([hidden])')?.textContent || '')`), 'focus: the quiet "Fixed while designing" line');
    }
    await sweep(`focus-${tab}`);
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  expect(await evaluate(`![...document.querySelectorAll('.gfx')].some(e => e.getBoundingClientRect().width > 0)`), 'focus: Escape closes');

  // Error: a limit reply keeps the brief and offers Try again.
  stub.creative = 'limit';
  await open({ look: 'creative' });
  await typeBrief(BRIEF);
  await evaluate(`document.getElementById('gen-submit').click()`);
  expect(await waitFor(`!document.getElementById('gen-notice').hidden && !window.FrameUpGenerate.isBusy()`, 15000), 'error: a notice shows');
  expect(await evaluate(`document.getElementById('gen-brief').value.length > 10`), 'error: the brief is kept');
  await sweep('error');
  stub.creative = 'ok';

  // The live shape of a plan (proxied ES photos, no plan.imagery): the page's
  // cut-out step runs, and the Creative designs must stay (never fall back to
  // the template flow once designs are made).
  stub.live = true;
  await open({ look: 'creative' });
  await typeBrief(BRIEF);
  await evaluate(`window.__qaFallback = 0; document.addEventListener('frameup:qa-noop', () => {}); true`);
  await evaluate(`document.getElementById('gen-submit').click()`);
  await waitFor(`!window.FrameUpGenerate.isBusy() && (document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length > 0 || !document.getElementById('gen-notice').hidden || !document.getElementById('gen-director').hidden)`, 60000);
  await sleep(800);
  const live = await evaluate(`({ cards: document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length, director: !document.getElementById('gen-director').hidden, notice: document.getElementById('gen-notice').hidden ? '' : document.getElementById('gen-notice').textContent.trim() })`);
  expect(live.cards >= 2 && !live.director && !/ES templates/.test(live.notice), `live plan: Creative designs stay (got ${live.cards} cards, directions ${live.director ? 'shown' : 'hidden'}, notice "${live.notice.slice(0, 80)}")`);
  await sweep('results-live');
  stub.live = false;

  // ES templates with nothing that fits: the "No designs" notice.
  await open({ look: 'templates' });
  await evaluate(`document.getElementById('gen-plan')?.getAttribute('aria-checked') === 'true' && document.getElementById('gen-plan').click(), true`);
  await typeBrief(BRIEF);
  await evaluate(`document.getElementById('gen-submit').click()`);
  expect(await waitFor(`!document.getElementById('gen-notice').hidden && !window.FrameUpGenerate.isBusy()`, 20000), 'templates: an empty reply says why');
  await sweep('templates-empty');

  // gen v4 #6: a run that goes past its estimate says so (bar stops short).
  await open({ look: 'creative' });
  await evaluate(`window.__qaProgress = window.FrameUpGenerate.startProgress(['Reading ES coverage', 'Art director planning', 'Composing candidates', 'Art director judging'], [1000, 2000], { eta: 5 }), true`);
  await sleep(7000);
  expect(await evaluate(`document.querySelector('#gen-progress .gen-progress__eta')?.classList.contains('is-over') && /longer than usual/i.test(document.getElementById('gen-progress').textContent)`), 'eta: a long run says it is taking longer than usual');
  await sweep('progress-long');
  await evaluate(`window.__qaProgress.stop(), true`);

  // gen v4 #8: the AI usage card opens its details (per tool, team, resets, free mode).
  await open();
  await waitFor(`Boolean(document.querySelector('button.es-usage__card'))`, 8000);
  await evaluate(`document.querySelector('button.es-usage__card')?.click(), true`);
  await sleep(300);
  expect(await evaluate(`(() => { const p = document.querySelector('.es-usage__pop:not([hidden])'); return Boolean(p) && p.querySelectorAll('.es-usage__list li').length === 3 && /Team/.test(p.textContent) && /What counts/.test(p.textContent) && /Free mode/.test(p.textContent) && /Resets/.test(p.textContent); })()`), 'usage: the details show per tool, team, what counts, resets and free mode');
  await evaluate(`window.__qaScope = '.es-sidebar', true`);
  await sweep('usage-open');
  await evaluate(`window.__qaScope = '', true`);

  // Free mode.
  stub.free = true;
  await open();
  await sleep(800);
  expect(await evaluate(`document.documentElement.dataset.aiMode === 'free'`), 'free mode: the page knows');
  await sweep('free-mode');
  stub.free = false;

  // One design.
  stub.one = true;
  await open({ look: 'creative' });
  await evaluate(`document.querySelector('#gen-count [data-count="1"], #gen-count button')?.click()`);
  await typeBrief(BRIEF);
  await evaluate(`document.getElementById('gen-submit').click()`);
  await waitFor(`document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length >= 1 && !window.FrameUpGenerate.isBusy()`, 60000);
  await sleep(500);
  await sweep('one-design');
  stub.one = false;

  const bad = results.filter(r => r.issues.length);
  bad.forEach(r => console.log(`FAIL ${r.state} ${r.w} ${r.theme}: ${r.issues.join('; ')}`));
  behaviour.forEach(b => console.log(`FAIL behaviour: ${b}`));
  if (gridAll.size) console.log(`note: ${gridAll.size} off-grid spacing value(s) (not multiples of 4): ${[...gridAll].slice(0, process.env.QA_UI_ALL ? 999 : 12).join('; ')}${gridAll.size > 12 && !process.env.QA_UI_ALL ? ' …' : ''}`);
  const states = new Set(results.map(r => r.state)).size;
  console.log(`generate ui: ${results.length} sweeps (${states} states x 3 widths x 2 themes) in ${Math.round((Date.now() - started) / 1000)}s; ${bad.length} with problems, ${behaviour.length} behaviour failure(s)`);
  if (bad.length || behaviour.length) exitCode = 1;
} catch (error) {
  console.error('generate ui: error', error);
  exitCode = 1;
} finally {
  stop();
}
process.exit(exitCode);
