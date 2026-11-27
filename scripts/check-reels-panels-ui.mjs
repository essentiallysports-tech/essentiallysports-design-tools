#!/usr/bin/env node
// Reels Studio: the ideas room and the radar (reel-ideas.js, reel-radar.js) in
// a real browser, in sample-data mode (localhost: no AI, no network calls).
// Headless Chrome over the DevTools protocol, a tiny static server and a
// stubbed /api (config + trends only; the panels must not call anything else).
//
// For each width (1440 / 1024 / 375) in light and dark:
//   both panels open from "Need an idea?" on Create (v3: a dialog with two
//     tabs, radar and ideas);
//   ideas room: opens from "Brainstorm angles" with the picked trend as the
//     topic, cost shown, Brainstorm -> sources + angle cards; the free-draft,
//     over-budget, empty and error states; "Use this angle" builds the reel
//     (plan applied, Review step) with no API call;
//   radar: trends with ES fit and ES angle, clip cards that link out, "views
//     unknown", a sport that is not covered, no clips, the AI read (and that it
//     says it cannot watch the videos), "Make our version" -> the ideas room
//     with the story as the topic and the brief as a note;
//   every state: no horizontal scroll, nothing clipped or overlapping (the
//     shared reels audit), one primary button, no console errors, no API call
//     other than config / trends.
// REELS_SHOTS=<dir> saves a screenshot per state. REELS_ONLY=375 runs one width.
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
if (!CHROME) { console.log('reels panels ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels panels ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.REELS_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WIDTHS = (process.env.REELS_ONLY || '1440,1024,375').split(',').map(Number);

const now = Date.now();
const TRENDS = {
  ok: true, hours: 48, stale: false, updatedAt: new Date(now).toISOString(),
  items: [
    { id: 't1', sport: 'nfl', title: 'Josh Allen throws for 412 yards and 4 TDs as the Bills beat the Chiefs 31-28', source: 'ESPN', url: 'https://example.com/a', publishedAt: new Date(now - 3600e3).toISOString(), team: 'Buffalo Bills', format: 'stat', fit: 85, related: [] },
    { id: 't2', sport: 'cfb', title: 'Ohio State stays No. 1 after a 38-10 win over Michigan State', source: 'CBS Sports', url: 'https://example.com/c', publishedAt: new Date(now - 7200e3).toISOString(), team: 'Ohio State Buckeyes', format: 'explainer', fit: 75, related: [] },
  ],
};
const apiCalls = [];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webm': 'video/webm', '.ico': 'image/x-icon' };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname.startsWith('/api/')) {
    const body = await readBody(req);
    apiCalls.push(`${url.pathname}:${body.mode || ''}`);
    if (url.pathname === '/api/reel-maker' && body.mode === 'config') { send(200, { ok: true, ai: true, voice: { mode: 'off', ready: false, label: 'Captions only', reason: '' }, music: { ready: false }, formats: [], dataFormats: [], formatModes: {}, aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: false } }); return; }
    if (url.pathname === '/api/reel-maker' && body.mode === 'trends') { send(200, TRENDS); return; }
    if (url.pathname === '/api/ai-status') { send(200, { ok: true, mode: 'ai', reason: null }); return; }
    if (url.pathname === '/api/es-image-search') { send(200, { source: 'es', results: [] }); return; }
    send(200, { ok: true, cloud: false, projects: [], clips: [], items: [] });
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-reels-panels-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
let consoleErrors = [];
const IGNORE_CONSOLE = [/supabase\.co/, /fonts\.(googleapis|gstatic)/, /cdn\.jsdelivr/, /favicon/, /ERR_BLOCKED_BY_CLIENT/];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = `${m.params.entry.text} ${m.params.entry.url || ''}`; if (!IGNORE_CONSOLE.some(r => r.test(t))) consoleErrors.push('log: ' + t.slice(0, 200)); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });

const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const who='qa'+String.fromCharCode(64)+'essentiallysports.com'; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:who,exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:who,aud:'authenticated',role:'authenticated'}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`;
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
await evaluate(SESSION);

async function setViewport(w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 812 : 1000, deviceScaleFactor: 1, mobile: w < 768 });
}
async function load() {
  await evaluate(`(() => { try { for (const k of Object.keys(localStorage)) if (/reel/i.test(k)) localStorage.removeItem(k); sessionStorage.clear(); sessionStorage.setItem('frameup.tours.offered', '1'); } catch {} return 1; })()`);
  await send('Page.navigate', { url: `${base}/reel-maker.html` });
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    const ok = await evaluate(`Boolean(window.ReelMakerCtx && window.ReelMakerCtx.modules.ideas && window.ReelMakerCtx.modules.radar && document.querySelector('#rm-trends [data-trend]') && document.querySelector('#rm-inspire-link')) && !/login/.test(location.pathname)`).catch(() => false);
    if (ok) break;
  }
  if (/login/.test(await evaluate('location.pathname'))) throw new Error('sign-in gate: reel-maker.html went to login');
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 1; })()`);
  await sleep(400);
  consoleErrors = [];
  apiCalls.length = 0;
}

const PANEL = '.rm-inspo__host:not([hidden])';
const AUDIT = fs.readFileSync(path.join(ROOT, 'scripts/lib/reels-ui-audit.js'), 'utf8');
// .rb-poll: a card cut by the panel's scroll edge reads as an empty band to the audit.
const IGNORE = ['.es-skeleton', '.es-sr-only', '.rb-clip__caption', '.rb-stamp', '.rb-poll'];
const results = [];
let failures = 0;
const fail = (where, what) => { failures += 1; console.log(`❌ ${where}: ${what}`); };
async function audit(name, w) {
  for (const theme of ['light', 'dark']) {
    await evaluate(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); window.FrameUpTheme?.apply?.(${JSON.stringify(theme)}); return 1; })()`).catch(() => {});
    await sleep(120);
    const r = await evaluate(`(${AUDIT})({ roots: ${JSON.stringify([PANEL])}, warns: false, ignore: ${JSON.stringify(IGNORE)}, keyActions: ['.rb-form__go', '[data-use]', '[data-make]', '[data-read]'] })`);
    // Panel rules: no sideways scroll (page or dialog), one primary button, everything inside the dialog.
    const own = await evaluate(`(() => {
      const hosts = [...document.querySelectorAll('.rm-inspo__host')].filter(h => !h.hidden && h.offsetParent); const out = [];
      if (hosts.length !== 1) return [hosts.length + ' panels showing (want 1)'];
      const d = hosts[0];
      if (document.querySelector('.rb-dialog, #rb-entry-ideas, #rb-entry-radar')) out.push('the temporary dialog or buttons are still on the page');
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('the page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth);
      if (d.scrollWidth > d.clientWidth + 1) out.push('the panel scrolls sideways: ' + d.scrollWidth + ' > ' + d.clientWidth);
      const box = d.getBoundingClientRect();
      const out2 = [...d.querySelectorAll('*')].filter(e => e.offsetParent && !e.closest('.es-sr-only')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); });
      if (out2.length) out.push('sticks out of the panel: ' + out2.slice(0, 3).map(e => (e.className || e.tagName) + ' by ' + Math.round(Math.max(e.getBoundingClientRect().right - box.right, box.left - e.getBoundingClientRect().left))).join(' | '));
      const primary = [...document.querySelectorAll('#main .es-btn--primary')].filter(b => b.offsetParent && !b.closest('[inert]'));
      if (primary.length !== 1 || !d.contains(primary[0])) out.push(primary.length + ' primary buttons on the screen (want 1, in the panel): ' + primary.map(b => b.id || b.textContent.trim()).join(', '));
      const small = [...d.querySelectorAll('button, a.rb-clip__link, summary, select, input[type=text], textarea')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 31);
      if (small.length) out.push('tap targets under 32px: ' + small.slice(0, 3).map(b => (b.className || b.tagName) + ' ' + Math.round(b.getBoundingClientRect().height)).join(' | '));
      const unlabelled = [...d.querySelectorAll('select, input, textarea')].filter(f => f.offsetParent && !f.labels?.length && !f.getAttribute('aria-label'));
      if (unlabelled.length) out.push('fields without a label: ' + unlabelled.map(f => f.id || f.tagName).join(', '));
      return out;
    })()`);
    const issues = [...r.issues, ...own, ...consoleErrors.splice(0)];
    results.push({ state: name, width: w, theme, issues });
    issues.forEach(i => fail(`${w} ${theme} ${name}`, i));
    if (SHOTS) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTS, `${w}-${theme}-${name.replace(/[^a-z0-9]+/gi, '_')}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await evaluate(`document.documentElement.setAttribute('data-theme', 'light')`);
}
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const must = async (sel, what) => { if (!(await click(sel))) throw new Error(`${what || sel}: not found`); };
const waitFor = async (expr, ms = 8000, what = expr) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(100); } throw new Error(`timed out waiting for ${what}`); };
const pickState = (sel, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const text = sel => evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`);
const count = sel => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const expect = (where, ok, what) => { if (!ok) fail(where, what); };

try {
  for (const w of WIDTHS) {
    await setViewport(w);
    await load();
    const at = `${w}`;

    // ── Ideas room ─────────────────────────────────────────────────────────
    // v3: inspiration lives behind "Need an idea?" (a dialog with two tabs) on Create.
    await must('#rm-trends [data-trend="t1"]', 'the first trend');
    await must('#rm-inspire-link', 'the "Need an idea?" link');
    await waitFor(`Boolean(document.querySelector('dialog[open]')) && !document.querySelector('#rm-inspo-tabs').hidden`, 4000, 'the inspiration dialog');
    await must('#rm-inspo-tabs [data-inspo="ideas"]', 'the ideas tab');
    await waitFor(`Boolean(document.querySelector('#rm-ideas-host:not([hidden]) #rb-ideas-topic')) && document.querySelector('#rm-radar-host').hidden`, 4000, 'the ideas room');
    expect(at, !(await count('.rb-dialog')) && !(await count('#rb-entry-ideas, #rb-entry-radar')), 'the temporary dialog or buttons are still on the page');
    expect(at, !(await count('#rb-ideas-close')), 'an inline panel has a close button');
    expect(at, /Josh Allen throws for 412 yards/.test(await evaluate(`document.querySelector('#rb-ideas-topic').value`)), 'the topic is not prefilled from the picked trend');
    expect(at, (await evaluate(`document.querySelector('#rb-ideas-sport').value`)) === 'nfl', 'the sport is not prefilled');
    expect(at, /Sample data: no cost/.test(await text('#rb-ideas-cost')), 'sample mode does not say it is free');
    expect(at, /Sample data/.test(await text('.rb-ideas .rb-demo')), 'no "Sample data" label');
    expect(at, /No angles yet/.test(await text('#rb-ideas-out')), 'no empty state before the first run');
    await audit('ideas-empty', w);
    await must('#rb-ideas-go', 'Brainstorm');
    expect(at, /Reading ES coverage/.test(await text('#rb-ideas-out')), 'no loading state');
    await waitFor(`document.querySelectorAll('.rb-angle [data-use]').length === 5`, 5000, 'five angle cards');
    expect(at, (await count('.rb-srclist .rb-src')) === 7, 'the gathered sources are not listed');
    expect(at, (await count('.rb-srclist a[target="_blank"][rel="noopener noreferrer"]')) === 3, 'ES articles do not link out safely');
    expect(at, /Most read/.test(await text('.rb-srclist')), 'no "Most read" mark on ES articles');
    expect(at, /ES articles: 3 · Trend headlines: 2 · Game results: 1 · Player stats: 1/.test(await text('.rb-sources')), 'what was gathered is not summarised');
    expect(at, (await count('.rb-angle .rb-lens')) === 5 && (await count('.rb-angle .rb-hook .rb-pill')) >= 10 && (await count('.rb-angle .rb-poll')) === 5, 'an angle card is missing its lens, hook or poll');
    expect(at, /1 idea was dropped by the fact check/.test(await text('.rb-dropped')), 'dropped ideas are not reported');
    await audit('ideas-angles', w);
    await pickState('#rb-ideas-demo', 'free');
    await waitFor(`document.querySelectorAll('.rb-angle .es-badge--warn').length === 3`, 5000, 'free drafts');
    expect(at, /Free drafts/.test(await text('.rb-callout')) && !(await count('.rb-callout--warn')), 'free mode is not explained');
    await audit('ideas-free', w);
    await pickState('#rb-ideas-demo', 'over');
    await waitFor(`Boolean(document.querySelector('.rb-callout--warn'))`, 5000, 'the over-budget note');
    expect(at, /Over the AI budget/.test(await text('.rb-callout--warn')), 'over budget is not explained');
    await audit('ideas-over-budget', w);
    await pickState('#rb-ideas-demo', 'empty');
    await waitFor(`/No angle held up/.test(document.querySelector('#rb-ideas-out').textContent)`, 5000, 'the no-angles state');
    await audit('ideas-none', w);
    await pickState('#rb-ideas-demo', 'error');
    await waitFor(`Boolean(document.querySelector('#rb-ideas-out [role="alert"] [data-retry]'))`, 5000, 'the error state');
    await audit('ideas-error', w);
    await pickState('#rb-ideas-demo', 'live');
    await waitFor(`document.querySelectorAll('.rb-angle [data-use]').length === 5`, 5000, 'angles again');
    // Too short a topic: said in words, nothing runs.
    await evaluate(`(() => { const t = document.querySelector('#rb-ideas-topic'); t.value = 'a'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#rb-ideas-go').click(); return 1; })()`);
    expect(at, /Type a topic or pick a trend first/.test(await text('#rb-ideas-out')), 'a short topic is not explained');
    await evaluate(`(() => { const t = document.querySelector('#rb-ideas-topic'); t.value = 'Sam Rivers extension'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#rb-ideas-go').click(); return 1; })()`);
    await waitFor(`document.querySelectorAll('.rb-angle [data-use]').length === 5`, 5000, 'angles for a typed topic');
    // Use this angle: the reel is built by code from the validated plan.
    apiCalls.length = 0;
    await must('.rb-angle [data-use="i1"]', 'Use this angle');
    await waitFor(`window.ReelMakerCtx.state.plan && window.ReelMakerCtx.state.plan.lens === 'money'`, 5000, 'the plan to be applied');
    const plan = await evaluate(`(() => { const p = window.ReelMakerCtx.state.plan; return { beats: p.beats.length, first: p.beats[0].block.type, last: p.beats[p.beats.length - 1].block.type, style: p.style, ids: p.beats.every(b => b.id), tl: window.ReelMakerCtx.state.timeline ? window.ReelMakerCtx.state.timeline.beats.length : 0, sources: window.ReelMakerCtx.state.sources.length, pane: Boolean(document.querySelector('#rm-pane-edit') && !document.querySelector('#rm-pane-edit').hidden) }; })()`);
    expect(at, plan.beats === 6 && plan.first === 'hook' && plan.last === 'endcard' && ['gametape', 'statcard', 'receipts', 'hypecut'].includes(plan.style) && plan.ids && plan.tl === 6, `the storyboard was not built from the angle: ${JSON.stringify(plan)}`);
    expect(at, !(await count('dialog[open]')), 'the inspiration dialog stayed open after "Use this angle"');
    expect(at, plan.sources === 7 && plan.pane, `the reel did not open in Review with its sources: ${JSON.stringify(plan)}`);
    await sleep(600);
    expect(at, !apiCalls.some(c => /:(plan|ideas|revise)$/.test(c)), `"Use this angle" called the AI: ${apiCalls.join(', ')}`);
    consoleErrors.splice(0).forEach(e => fail(`${at} use-angle`, e));

    // ── Radar ──────────────────────────────────────────────────────────────
    await load();
    await must('#rm-inspire-link', 'the "Need an idea?" link');
    await waitFor(`Boolean(document.querySelector('dialog[open]')) && !document.querySelector('#rm-inspo-tabs').hidden`, 4000, 'the Inspiration tabs');
    await must('#rm-inspo-tabs [data-inspo="ideas"]', 'the ideas tab');
    await waitFor(`!document.querySelector('#rm-ideas-host').hidden && document.querySelector('#rm-radar-host').hidden`, 3000, 'the ideas tab to show the ideas room');
    await must('#rm-inspo-tabs [data-inspo="radar"]', 'the radar tab');
    await waitFor(`!document.querySelector('#rm-radar-host').hidden && document.querySelector('#rm-ideas-host').hidden && document.querySelectorAll('#rm-radar-host .rb-trend[data-trend]').length === 7`, 5000, 'the radar trends');
    expect(at, (await count('.rb-trend .rb-trend__angle')) === 4 && /ES fit 90/.test(await text('.rb-trends')), 'trends do not show ES fit and the ES angle');
    expect(at, /No clip search/.test(await text('.rb-trends')), 'sports without clip search are not marked');
    expect(at, /Pick a story/.test(await text('#rb-radar-out')), 'no empty state before a pick');
    await audit('radar-empty', w);
    await must('.rb-trend[data-trend="s-admirals-qb"]', 'a trend');
    await waitFor(`document.querySelectorAll('.rb-clip a.rb-clip__link').length === 6`, 5000, 'six clip cards');
    expect(at, (await evaluate(`[...document.querySelectorAll('.rb-clip a')].every(a => /^https:\\/\\/x\\.com\\//.test(a.href) && a.target === '_blank' && /noopener/.test(a.rel))`)), 'a clip does not link out to X safely');
    expect(at, (await count('.rb-radar video, .rb-radar iframe')) === 0, 'a clip is embedded');
    expect(at, /Ranked by views per hour/.test(await text('#rb-radar-out')) && /613k views an hour/.test(await text('.rb-clips')), 'the ranking is not explained');
    expect(at, /style reference only/.test(await text('#rb-radar-out')), 'no "style reference only" note');
    expect(at, /cannot watch the videos/.test(await text('.rb-read')), 'the AI read does not say it cannot watch the videos');
    await audit('radar-clips', w);
    await must('[data-read]', 'Read these clips');
    await waitFor(`document.querySelectorAll('.rb-brief [data-make]').length === 3`, 5000, 'the read and three briefs');
    expect(at, (await count('.rb-patterns li')) === 4 && /did not watch the videos/.test(await text('.rb-read')), 'the AI read is incomplete');
    await audit('radar-read', w);
    await pickState('#rb-radar-demo', 'unknown');
    await waitFor(`document.querySelectorAll('.rb-clip__stats.is-unknown').length === 6`, 5000, '"views unknown" on every clip');
    expect(at, /Views unknown/.test(await text('.rb-clips')) && /Newest first/.test(await text('#rb-radar-out')) && !/views an hour/.test(await text('.rb-clips')), '"views unknown" is not handled');
    await audit('radar-views-unknown', w);
    await pickState('#rb-radar-demo', 'empty');
    await waitFor(`/No official clips yet/.test(document.querySelector('#rb-radar-out').textContent)`, 5000, 'the no-clips state');
    await audit('radar-no-clips', w);
    await pickState('#rb-radar-demo', 'error');
    await waitFor(`Boolean(document.querySelector('#rb-radar-out [role="alert"] [data-retry]'))`, 5000, 'the error state');
    await audit('radar-error', w);
    await pickState('#rb-radar-demo', 'live');
    await must('.rb-trend[data-trend="s-hoops-trade"]', 'an NBA trend');
    await waitFor(`/No clip search for this sport yet/.test(document.querySelector('#rb-radar-out').textContent)`, 5000, 'the not-covered state');
    await audit('radar-sport-not-covered', w);
    // Keyboard: arrows move through the trends; the picked one is the tab stop.
    await evaluate(`(() => { document.querySelector('.rb-trend[data-trend]').focus(); return 1; })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    const moved = await evaluate(`(() => { const rows = [...document.querySelectorAll('.rb-trend[data-trend]')]; return 'row ' + rows.indexOf(document.activeElement) + ', tab stops ' + document.querySelectorAll('.rb-trend[tabindex="0"]').length; })()`);
    expect(at, moved === 'row 1, tab stops 1', `arrow keys do not move through the trends: ${moved}`);
    // Make our version: the story is the topic, the brief only a note.
    await must('.rb-trend[data-trend="s-admirals-qb"]', 'a trend');
    await waitFor(`document.querySelectorAll('.rb-clip a.rb-clip__link').length === 6`, 5000, 'clips again');
    await must('[data-read]', 'Read these clips');
    await waitFor(`document.querySelectorAll('.rb-brief [data-make]').length === 3`, 5000, 'briefs again');
    await must('.rb-brief [data-make="1"]', 'Make our version');
    await waitFor(`!document.querySelector('#rm-ideas-host').hidden && document.querySelector('#rm-radar-host').hidden && document.querySelector('#rm-inspo-tabs [data-inspo="ideas"]').getAttribute('aria-checked') === 'true'`, 5000, 'the ideas room after the hand-off');
    const handed = await evaluate(`(() => { const s = window.ReelMakerCtx.modules.ideas.state(); return { topic: s.topic, sport: s.sport, steer: s.steer, field: document.querySelector('#rb-ideas-topic').value }; })()`);
    expect(at, /^Harbor City Admirals give quarterback Sam Rivers/.test(handed.topic) && handed.field === handed.topic && handed.sport === 'nfl', `the hand-off lost the story: ${JSON.stringify(handed)}`);
    expect(at, /^Treatment idea \(style only, not a fact\): The moment behind the moment/.test(handed.steer), `the brief did not travel as a note: ${handed.steer}`);
    await audit('radar-handoff', w);
    // Back: closing the dialog (Escape) puts the panels away; Make my reel and the trends are there.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(`!document.querySelector('dialog[open]') && Boolean(document.querySelector('#rm-make')?.offsetParent) && Boolean(document.querySelector('#rm-trends')?.offsetParent)`, 3000, 'Create after closing the inspiration dialog');
    expect(at, (await count('.rm-inspo__host:not([hidden])')) === 0 || (await evaluate(`[...document.querySelectorAll('.rm-inspo__host')].every(h => !h.offsetParent)`)), 'a panel still shows after going back');
    const stray = apiCalls.filter(c => !/^\/api\/(reel-maker:(config|trends|projects|event)|ai-status:|video-ads:|es-image-search:|version:)/.test(c));
    expect(at, !stray.length, `sample mode called the server: ${stray.join(', ')}`);
    consoleErrors.splice(0).forEach(e => fail(`${at} radar`, e));
  }
} catch (error) {
  failures += 1;
  console.log(`❌ ${error.stack || error}`);
} finally {
  cleanup();
}
const states = results.length;
console.log(failures ? `\nreels panels ui: ${failures} problem(s) in ${states} states` : `reels panels ui: ${states} states at ${WIDTHS.join(' / ')} in light and dark are clean (ideas room and radar, sample data)`);
process.exit(failures ? 1 : 0);
