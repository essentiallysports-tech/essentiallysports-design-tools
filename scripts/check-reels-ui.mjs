// Reels Studio v3 UI sweep (QA lane, 2026-11-27). Real headless Chrome over
// CDP (scripts/_qa-chrome.mjs: Node's built-in WebSocket, no npm deps). A local
// static server serves the repo; /api/* is stubbed: config and trends from
// fixtures, the script is the server's own code plan (AI off, no keys), and the
// v3 server modes are mocked in their contract shapes (scene-media: per-scene
// subjects, judged clips and verified photos with a pick; review: no issues;
// revise: a changed hook).
//
// The journey (contract ids): Create → Review → Export.
//   Create   one prompt card (#rm-prompt), 4 style cards (#rm-styles4: Game Tape,
//            Stat Card, Receipts, Hype Cut, each with a preview and one line),
//            Make my reel (#rm-make) with its expectation hint, "Start from a
//            trend", "Need an idea?" (#rm-inspire-link) and NO settings rail,
//            no looks / recipes / start tiles / "Soon".
//   Making   the step checklist (#rm-making) while the reel is made.
//   Review   the phone, the scene strip (#rm-scenes) with Swap on media scenes,
//            the "Ready to post" badge (#rm-ready) that expands to the checklist,
//            Ask AI (#rm-revise) and exactly three folds: Voice & music,
//            Captions, Details (#rm-voice, #rm-captions, #rm-details).
//   Export   one Export button (#rm-export) plus "Also export" (#rm-also: 4:5,
//            captions, carousel), Organic / Paid, the rights summary.
// Also: every style makes a reel (plan.style is the style id), script mode keeps
// the words, trends empty / error, free mode and the server-offline draft.
// Every state is audited in light and dark (scripts/lib/reels-ui-audit.js):
// doubled borders, empty bands, clipped text, horizontal scroll, misaligned
// siblings, non-ES fonts, unlabelled controls, more than one primary button,
// console errors, broken images, low contrast.
// The data formats (Game Swing / Replay / Archive, opened from elsewhere) are no
// longer swept here: the v3 journey has no entry to them on Create.
// Run: node scripts/check-reels-ui.mjs   (skips if Chrome isn't installed)
// Env: REELS_SHOTS=<dir> saves a PNG per state; REELS_ONLY=1440 (or 1440,1024,375) picks widths.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';

const require = createRequire(import.meta.url);
const CHROME = findChrome();
if (!CHROME) { console.log('reels ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.REELS_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WIDTHS = (process.env.REELS_ONLY || '1440,1024').split(',').map(Number);
const STYLE_IDS = ['gametape', 'statcard', 'receipts', 'hypecut'];
const STYLE_LABELS = ['Game Tape', 'Stat Card', 'Receipts', 'Hype Cut'];

// ─── Stubbed API ─────────────────────────────────────────────────────────────
const server_ = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;
const now = Date.now();
const TRENDS = {
  ok: true, hours: 48, stale: false, updatedAt: new Date(now).toISOString(),
  items: [
    { id: 't1', sport: 'nfl', title: 'Josh Allen throws for 412 yards and 4 TDs as the Bills beat the Chiefs 31-28', source: 'ESPN', url: 'https://example.com/a', publishedAt: new Date(now - 3600e3).toISOString(), team: 'Buffalo Bills', format: 'stat', related: [{ title: 'Allen’s third 400-yard game this season', url: 'https://example.com/b', source: 'NFL' }] },
    { id: 't2', sport: 'cfb', title: 'Ohio State stays No. 1 after a 38-10 win over Michigan State', source: 'CBS Sports', url: 'https://example.com/c', publishedAt: new Date(now - 7200e3).toISOString(), team: 'Ohio State Buckeyes', format: 'explainer', related: [] },
    { id: 't3', sport: 'mlb', title: 'Shohei Ohtani wins his fourth MVP award, the first unanimous pick since 2021', source: 'MLB', url: 'https://example.com/d', publishedAt: new Date(now - 10800e3).toISOString(), team: 'Los Angeles Dodgers', format: 'explainer', related: [] },
    { id: 't4', sport: 'golf', title: 'Scottie Scheffler closes with a 64 to win by three at the Tour Championship', source: 'PGA Tour', url: 'https://example.com/e', publishedAt: new Date(now - 14400e3).toISOString(), team: '', format: 'stat', related: [] },
  ],
};
const CLIP = { url: 'https://x.com/NFL/status/1855000000000000001', handle: 'NFL', text: 'Rodgers throws a dime on third down', thumb: '/design-request-hero.webp', postedAt: new Date(now - 3600e3).toISOString(), durationMs: 8000, variants: [{ url: '/design-request-banner.webm', width: 1280, height: 720 }] };
const PHOTOS = ['/how-step-choose.webp', '/how-step-content.webp', '/how-step-export.webp', '/how-step-format.webp', '/how-step-review.webp', '/login-artwork.webp'];
const BRIEF = "Aaron Rodgers' 2011 season still has no twin: 45 touchdowns, 6 interceptions, a 122.5 passer rating and a 15-1 record. Source: Pro Football Reference.";

// scene-media (contract): per beat a subject, judged clips, verified photos and a pick.
function sceneMedia(body) {
  const style = body.style || body.plan?.style || 'receipts';
  const beats = (body.plan?.beats || []).filter(b => !(b.kind === 'cta' || b.block?.type === 'endcard'));
  return {
    ok: true, style, cost: 0,
    beats: beats.map((b, i) => {
      const clips = [0, 1].map(k => ({ ...CLIP, url: `${CLIP.url.slice(0, -1)}${i}${k}`, text: `Clip ${k + 1} for scene ${i + 1}`, relevance: 0.9 - k * 0.1, judged: true }));
      const photos = [0, 1, 2].map(k => ({ id: `ph-${i}-${k}`, url: PHOTOS[(i + k) % PHOTOS.length], proxyUrl: PHOTOS[(i + k) % PHOTOS.length], verified: true, focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.3 }, head: { x: 0.35, y: 0.1, w: 0.3, h: 0.25 }, credit: 'ES', title: `Photo ${k + 1}` }));
      const kind = style === 'receipts' ? 'none' : (style === 'statcard' ? 'photo' : 'clip');
      return { beatId: b.id, subject: { type: 'player', name: 'Aaron Rodgers', team: 'Green Bay Packers', date: '2011' }, clips: style === 'receipts' ? [] : clips, photos: style === 'receipts' ? [] : photos, pick: kind === 'none' ? { kind: 'none', ref: null } : { kind, ref: kind === 'clip' ? clips[0].url : photos[0].id } };
    }),
  };
}

const scenario = { trends: 'ok', config: 'ok', slow: 0, planDelay: 0 };
const calls = []; // { mode, body } for every /api/reel-maker call
async function reelApi(body) {
  const free = scenario.config === 'free';
  const mode = body.mode;
  calls.push({ mode, body });
  if (scenario.config === 'offline') return { status: 404, body: '', type: 'text/plain' };
  if (mode === 'config') return { status: 200, body: { ok: true, ai: !free, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'Voice is not set up here.' }, music: { ready: false }, formats: [], dataFormats: ['gameswing', 'replay', 'archive'], formatModes: { games: true, 'game-data': true, athlete: true, 'archive-research': true, 'frame-pick': true }, aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: true }, sceneMedia: { ready: true }, review: { ready: true } } };
  if (mode === 'trends') {
    if (scenario.slow) await sleep(scenario.slow);
    if (scenario.trends === 'error') return { status: 502, body: { ok: false, error: 'Trends are unavailable right now.' } };
    if (scenario.trends === 'empty') return { status: 200, body: { ...TRENDS, items: [] } };
    return { status: 200, body: TRENDS };
  }
  if (mode === 'plan') {
    if (scenario.planDelay) await sleep(scenario.planDelay);
    const r = await server_.plan(body, { email: 'qa@essentiallysports.com' }, free ? { free: true } : { off: true });
    if (r.plan && body.style && !r.plan.style) r.plan.style = body.style;
    return { status: r.ok ? 200 : (r.status || 502), body: free ? { ...r, mode: 'free', reason: 'user-limit' } : r };
  }
  if (mode === 'scene-media') { if (scenario.planDelay) await sleep(scenario.planDelay / 2); return { status: 200, body: sceneMedia(body) }; }
  if (mode === 'review') return { status: 200, body: { ok: true, issues: [], fixed: null, cost: 0 } };
  if (mode === 'revise') {
    if (free) return { status: 200, body: { ok: true, skipped: true } };
    const plan = JSON.parse(JSON.stringify(body.plan || {}));
    if (plan.beats?.[0]) { plan.beats[0].text = '45 TD. 6 INT.'; plan.beats[0].vo = 'Forty-five touchdowns, six interceptions.'; if (plan.beats[0].block?.pills) plan.beats[0].block.pills = [{ text: '45 TD', color: 'ink' }, { text: '6 INT', color: 'ink' }]; }
    return { status: 200, body: { ok: true, plan, cost: 0.001 } };
  }
  if (['event', 'project-save', 'projects'].includes(mode)) return { status: 200, body: { ok: true, cloud: false, projects: [] } };
  return { status: 503, body: { ok: false, reason: 'off', error: 'AI is not available right now.' } };
}
async function api(req, url, body) {
  if (url.pathname === '/api/reel-maker') return reelApi(body || {});
  if (url.pathname === '/api/video-ads') {
    if (body?.mode === 'library') return { status: 200, body: { ok: true, clips: [CLIP] } };
    if (body?.mode === 'clip') return { status: 200, body: { ok: true, ...CLIP, url: body.url, thumbnail: CLIP.thumb } };
    return { status: 200, body: { ok: true, clips: [], cost: 0 } };
  }
  if (url.pathname === '/api/es-image-search') return { status: 200, body: { source: 'es', results: PHOTOS.map((p, i) => ({ id: `p${i}`, proxyUrl: p, title: `Photo ${i + 1}`, credit: 'ES', width: 1600, height: 900 })) } };
  if (url.pathname === '/api/ai-status') return { status: 200, body: scenario.config === 'free' ? { ok: true, mode: 'free', reason: 'user-limit', userLimitUsd: 20 } : { ok: true, mode: 'ai', reason: null } };
  if (url.pathname === '/api/trend-design') return { status: 200, body: { ok: true, items: [] } };
  return null;
}

const { server, base } = await startServer({ api });
const page = await startChrome(CHROME, { width: 1440, height: 1000 });
const { send, evaluate } = page;
let consoleErrors = [];
const IGNORE_CONSOLE = [/supabase\.co\/rest\/v1\//, /fonts\.(googleapis|gstatic)/, /cdn\.jsdelivr/, /favicon/];
page.on(m => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = `${m.params.entry.text} ${m.params.entry.url || ''}`; if (!IGNORE_CONSOLE.some(r => r.test(t)) && !(/Failed to load resource/.test(t) && /\/api\//.test(t))) consoleErrors.push('log: ' + t.slice(0, 200)); }
});
const cleanup = () => { page.close(); server.close(); };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
// Never write to production Supabase with the fake session (usage tracker, spend meter).
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
async function setViewport(w) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 812 : 1000, deviceScaleFactor: 1, mobile: w < 768 }); }
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
await evaluate(FAKE_SESSION);

async function load(q = '') {
  await evaluate(`(() => { try { for (const k of Object.keys(localStorage)) if (/reel/i.test(k)) localStorage.removeItem(k); sessionStorage.clear(); sessionStorage.setItem('frameup.tours.offered', '1'); } catch {} return 1; })()`);
  await send('Page.navigate', { url: `${base}/reel-maker.html${q}` });
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    const ok = await evaluate(`Boolean(window.ReelMakerPage && document.querySelector('#rm-pane-topic')) && document.documentElement.style.visibility !== 'hidden' && !/login/.test(location.pathname)`).catch(() => false);
    if (ok) break;
  }
  if (/login/.test(await evaluate('location.pathname'))) throw new Error('sign-in gate: reel-maker.html went to login');
  await evaluate(`(() => { const s = document.createElement('style'); s.id='qa-calm'; s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 1; })()`);
  await sleep(600);
  consoleErrors = [];
  calls.length = 0;
}

// ─── Audit ──────────────────────────────────────────────────────────────────
const AUDIT = fs.readFileSync(path.join(ROOT, 'scripts/lib/reels-ui-audit.js'), 'utf8');
const IGNORE = ['.rm-canvas', '.es-skeleton', '.es-sr-only', '[data-style-preview]'];
const KEY_ACTIONS = ['#rm-make', '#rm-next', '#rm-back', '#rm-export', '#rm-export-carousel'];
const results = [];
let stateCount = 0;
async function audit(name, w) {
  for (const theme of ['light', 'dark']) {
    await evaluate(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); window.FrameUpTheme?.apply?.(${JSON.stringify(theme)}); return 1; })()`).catch(() => {});
    await sleep(120);
    const run = () => evaluate(`(${AUDIT})({ roots: ['#main', '#rm-toasts', 'dialog[open]'], warns: ${theme === 'light'}, ignore: ${JSON.stringify(IGNORE)}, keyActions: ${JSON.stringify(KEY_ACTIONS)} })`);
    let r = await run();
    if (r.issues.length) { await sleep(700); r = await run(); }
    const head = await evaluate(`(() => { const h = document.querySelector('.rm-head'); if (!h) return ''; const kids = [...h.children].filter(k => k.getBoundingClientRect().height > 1 && getComputedStyle(k).display !== 'none' && getComputedStyle(k).position !== 'absolute'); const rs = kids.map(k => k.getBoundingClientRect()); return rs.some(a => rs.some(b => a.top >= b.bottom - 2)) ? 'the step bar wraps: ' + kids.map(k => k.className || k.tagName).join(' / ') : ''; })()`);
    if (head) r.issues.push(head);
    const errs = consoleErrors.splice(0);
    stateCount++;
    results.push({ state: name, width: w, theme, issues: [...r.issues, ...errs], warns: r.warns });
    if (SHOTS) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTS, `${w}-${theme}-${name.replace(/[^a-z0-9]+/gi, '_')}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await evaluate(`document.documentElement.setAttribute('data-theme', 'light')`);
}

// ─── Page actions ───────────────────────────────────────────────────────────
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const must = async (sel, what) => { if (!(await click(sel))) throw new Error(`${what || sel}: not found`); };
const waitFor = async (expr, ms = 15000, what = expr) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(150); } throw new Error(`timed out waiting for ${what}`); };
const typeInto = (sel, text) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const scrollTop = () => evaluate('(window.scrollTo(0, 0), document.querySelector("#rm-panel")?.scrollTo?.(0, 0), 1)');
const openFold = (sel, open = true) => evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); if (!d) return false; d.open = ${open}; d.scrollIntoView({ block: 'start' }); return true; })()`);
// Shown = laid out, not hidden, not inside a closed <details> body.
const SHOWN = `(e => { if (!e) return false; for (let a = e; a && a.nodeType === 1; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden') return false; if (a.tagName === 'DETAILS' && !a.open && a !== e && !e.closest('summary')) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })`;
const visible = sel => evaluate(`${SHOWN}(document.querySelector(${JSON.stringify(sel)}))`);
const key = async (k, { code = k, vk = 0, shift = false, alt = false } = {}) => { const mod = (alt ? 1 : 0) | (shift ? 8 : 0); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await sleep(60); };
const KEYS = { Tab: 9, Escape: 27, ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 };
const press = (k, opts = {}) => key(k, { vk: KEYS[k] || k.toUpperCase().charCodeAt(0), code: KEYS[k] ? k : `Key${k.toUpperCase()}`, ...opts });
const expect = (ok, what) => { if (!ok) throw new Error(what); };
const behaviour = [];
async function step(name, fn) { try { await fn(); } catch (error) { behaviour.push(`${name}: ${error.message}`); } }
const ctx = expr => evaluate(`(() => { const c = window.ReelMakerCtx || window.ReelMakerPage; return ${expr}; })()`);
const STYLE_CARDS = `[...document.querySelectorAll('#rm-styles4 [role="radio"]')]`;
const pickStyle = id => evaluate(`(() => { const b = ${STYLE_CARDS}.find(x => x.dataset.style === ${JSON.stringify(id)}); if (!b) return false; b.click(); return b.getAttribute('aria-checked') === 'true'; })()`);
const inReview = `${SHOWN}(document.querySelector('#rm-pane-edit')) && !document.querySelector('#rm-pane-edit').hidden`;
async function makeReel({ style = 'statcard', text = BRIEF, script = false } = {}) {
  await pickStyle(style);
  if (await evaluate(`Boolean(document.querySelector('#rm-script-mode'))`)) await evaluate(`(() => { const s = document.querySelector('#rm-script-mode'); if (s.checked !== ${script}) s.click(); return 1; })()`);
  await typeInto('#rm-prompt', text);
  await must('#rm-make', 'Make my reel');
  await waitFor(inReview, 40000, 'the Review step');
}
// The old Reels 2.0 Start UI must be gone (contract: looks, recipes, tiles, the rail).
const OLD_UI = ['#rm-fmt-entry', '#rm-recipes', '#rm-recipe-sec', '#rm-looks', '#rm-styles', '#rm-styles-edit', '#rm-style-fold', '#rm-settings', '#rm-costs', '#rm-more', '#rm-export-all', '#rm-versions', '#rm-statusline', '#rm-source'];
const oldShown = () => evaluate(`${JSON.stringify(OLD_UI)}.filter(s => ${SHOWN}(document.querySelector(s)))`);

// ─── The sweep ──────────────────────────────────────────────────────────────
const t0 = Date.now();
for (const w of WIDTHS) {
  const first = w === WIDTHS[0];
  await setViewport(w);
  Object.assign(scenario, { trends: 'ok', config: 'ok', slow: 4000, planDelay: 0 });
  await load();
  await audit('create-trends-loading', w);
  await waitFor(`document.querySelector('#rm-trends')?.getAttribute('aria-busy') === 'false'`, 8000, 'trends').catch(e => behaviour.push(e.message));
  scenario.slow = 0;
  await scrollTop();
  await audit('create', w);

  await step('Create: three steps, Create → Review → Export', async () => {
    const steps = await evaluate(`[...document.querySelectorAll('#rm-steps .rm-step')].map(b => b.textContent.replace(/\\d/g, '').trim())`);
    expect(steps.join('|') === 'Create|Review|Export', `steps: ${steps.join(' | ')}`);
    expect(await evaluate(`document.querySelector('#rm-steps [data-step="topic"]').getAttribute('aria-current') === 'step'`), 'Create is not the current step');
  });
  await step('Create: one prompt card and one Make my reel', async () => {
    expect(await visible('#rm-prompt'), 'the prompt (#rm-prompt) is not shown');
    expect(await visible('#rm-make'), 'Make my reel (#rm-make) is not shown');
    expect(/make my reel/i.test(await evaluate(`document.querySelector('#rm-make').textContent`)), 'the button does not say Make my reel');
    expect(await evaluate(`document.querySelector('#rm-make').matches('.es-btn--primary')`), 'Make my reel is not the primary button');
  });
  await step('Create: four style cards with a preview and one line', async () => {
    const cards = await evaluate(`${STYLE_CARDS}.map(b => ({ id: b.dataset.style, text: b.textContent.replace(/\\s+/g, ' ').trim(), preview: Boolean(b.querySelector('canvas, video, img')), checked: b.getAttribute('aria-checked'), shown: ${SHOWN}(b) }))`);
    expect(cards.length === 4, `${cards.length} style cards`);
    expect(cards.map(c => c.id).join() === STYLE_IDS.join(), `style ids: ${cards.map(c => c.id).join()}`);
    cards.forEach((c, i) => {
      expect(c.text.includes(STYLE_LABELS[i]), `card ${c.id} does not say "${STYLE_LABELS[i]}": ${c.text}`);
      expect(c.text.length > STYLE_LABELS[i].length + 8, `card ${c.id} has no one-line description`);
      expect(c.preview, `card ${c.id} has no preview (canvas / video / img)`);
      expect(c.shown, `card ${c.id} is not shown`);
    });
    expect(cards.filter(c => c.checked === 'true').length === 1, 'exactly one style should be picked');
  });
  await step('Create: picking a style updates the expectation hint', async () => {
    for (let i = 0; i < 4; i++) {
      expect(await pickStyle(STYLE_IDS[i]), `${STYLE_IDS[i]} did not get picked`);
      await sleep(80);
      const hint = await evaluate(`document.querySelector('#rm-make-hint')?.textContent || ''`);
      expect(hint.includes(STYLE_LABELS[i]), `hint does not name ${STYLE_LABELS[i]}: "${hint}"`);
      expect(/\d+\s?(s|sec|seconds)\b/i.test(hint), `hint has no length: "${hint}"`);
    }
  });
  await step('Create: the style cards are one radio group (arrow keys move the pick)', async () => {
    await pickStyle('gametape');
    await evaluate(`(${STYLE_CARDS}[0].focus(), 1)`);
    await press('ArrowRight');
    const r = await evaluate(`({ on: ${STYLE_CARDS}.find(b => b.getAttribute('aria-checked') === 'true')?.dataset.style, focus: document.activeElement?.dataset?.style, tabs: ${STYLE_CARDS}.map(b => b.tabIndex) })`);
    expect(r.on === 'statcard' && r.focus === 'statcard', `after ArrowRight: picked ${r.on}, focus ${r.focus}`);
    expect(r.tabs.filter(t => t === 0).length === 1, `roving tabindex: ${r.tabs}`);
  });
  await step('Create: no settings rail, no old Start UI, nothing marked Soon', async () => {
    const folds = await evaluate(`['#rm-voice', '#rm-captions', '#rm-details', '#rm-revise', '#rm-ready', '#rm-scenes'].filter(s => ${SHOWN}(document.querySelector(s)))`);
    expect(!folds.length, `shown on Create: ${folds.join(', ')}`);
    const old = await oldShown();
    expect(!old.length, `old Start UI still shown: ${old.join(', ')}`);
    const soon = await evaluate(`[...document.querySelectorAll('#main *')].filter(e => e.children.length === 0 && /^\\s*soon\\s*$/i.test(e.textContent) && ${SHOWN}(e)).length`);
    expect(!soon, `${soon} "Soon" labels`);
  });
  await step('Create: Start from a trend and Need an idea?', async () => {
    expect(await visible('#rm-trends'), 'the trend row is not shown');
    expect(/start from a trend/i.test(await evaluate(`document.querySelector('#rm-pane-topic').textContent`)), 'no "Start from a trend" heading');
    expect(await visible('#rm-inspire-link'), '"Need an idea?" (#rm-inspire-link) is not shown');
    expect(/need an idea\?/i.test(await evaluate(`document.querySelector('#rm-inspire-link').textContent`)), 'the link does not say "Need an idea?"');
  });
  await step('Need an idea? opens inspiration', async () => {
    await must('#rm-inspire-link');
    await waitFor(`Boolean(document.querySelector('dialog[open]')) || ${SHOWN}(document.querySelector('#rm-radar-host, #rm-ideas-host'))`, 3000, 'the inspiration panel');
  });
  await audit('create-need-an-idea', w);
  await step('Need an idea? closes with Escape and gives focus back', async () => {
    if (await evaluate(`Boolean(document.querySelector('dialog[open]'))`)) {
      await press('Escape');
      await waitFor(`!document.querySelector('dialog[open]')`, 2000, 'the dialog to close');
      expect(await evaluate(`document.activeElement?.id === 'rm-inspire-link'`), `focus went to ${await evaluate('document.activeElement?.id || document.activeElement?.tagName')}`);
    }
  });
  await step('empty prompt is refused', async () => {
    await typeInto('#rm-prompt', '');
    await must('#rm-make');
    await waitFor(`(document.querySelector('#rm-write-status')?.textContent || '').trim().length > 0`, 3000, 'a message under Make my reel');
    expect(!(await evaluate(inReview)), 'went to Review with no prompt');
  });
  await audit('create-empty-error', w);
  await step('pick a trend', async () => {
    await must('#rm-trends [data-trend], #rm-trends button', 'trend row');
    await waitFor(`(window.ReelMakerCtx?.state.trend) || ${SHOWN}(document.querySelector('#rm-picked')) || document.querySelector('#rm-prompt').value.length > 10`, 3000, 'picked story');
  });
  await audit('create-trend-picked', w);

  // Make → making checklist → Review.
  await load();
  scenario.planDelay = 2500;
  await step('Make my reel shows the making checklist', async () => {
    await pickStyle('statcard');
    await typeInto('#rm-prompt', BRIEF);
    await must('#rm-make');
    await waitFor(`${SHOWN}(document.querySelector('#rm-making')) && document.querySelectorAll('#rm-making li').length >= 3`, 4000, 'the making checklist');
  });
  await audit('making', w);
  scenario.planDelay = 0;
  await step('… then Review', async () => { await waitFor(inReview, 40000, 'the Review step'); });
  await step('Review: plan has the picked style; Review is the current step', async () => {
    const st = await ctx(`c.state.plan && c.state.plan.style`);
    expect(st === 'statcard', `plan.style is ${st}`);
    expect(await evaluate(`document.querySelector('#rm-steps [data-step="edit"]').getAttribute('aria-current') === 'step'`), 'Review is not the current step');
  });
  await step('Review: scene media came from the sourcing pass (scene-media + review)', async () => {
    const modes = calls.map(c => c.mode);
    expect(modes.includes('scene-media'), `no scene-media call (calls: ${[...new Set(modes)].join(',')})`);
    expect(modes.includes('review'), `no review call (calls: ${[...new Set(modes)].join(',')})`);
    const sm = calls.find(c => c.mode === 'scene-media');
    expect(sm.body.style === 'statcard', `scene-media sent style ${sm.body.style}`);
  });
  await scrollTop();
  await audit('review', w);
  await step('Review: Ready to post badge, expands to the checklist', async () => {
    expect(await visible('#rm-ready'), 'no Ready badge (#rm-ready)');
    await waitFor(`/ready to post/i.test(document.querySelector('#rm-ready').textContent)`, 6000, '"Ready to post"');
    await must('#rm-ready');
    await waitFor(`document.querySelector('#rm-ready').getAttribute('aria-expanded') === 'true' && ${SHOWN}(document.querySelector('#rm-lint'))`, 2000, 'the checklist');
    expect(await evaluate(`document.querySelectorAll('#rm-checklist li').length`) >= 3, 'the checklist has fewer than 3 rows');
  });
  await audit('review-ready-open', w);
  await click('#rm-ready');
  await step('Review: one scene card per scene', async () => {
    const r = await ctx(`({ beats: c.state.plan.beats.length, cards: document.querySelectorAll('#rm-scenes [data-beat]').length, shown: ${SHOWN}(document.querySelector('#rm-scenes')) })`);
    expect(r.shown, 'the scene strip (#rm-scenes) is not shown');
    expect(r.cards === r.beats && r.cards >= 3, `cards ${r.cards} / scenes ${r.beats}`);
  });
  await step('Review: Swap gives other verified media and uses the one picked', async () => {
    const SWAP = `[...document.querySelectorAll('#rm-scenes button, #rm-scene-edit button')].filter(b => /swap/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '')) && ${SHOWN}(b))`;
    const n = await evaluate(`${SWAP}.length`);
    expect(n >= 1, 'no Swap control on any scene');
    const before = await ctx(`(() => { const b = c.state.plan.beats.find(x => (c.state.photos[x.id] || []).length); return b ? { id: b.id, media: c.state.photos[b.id][0] } : null; })()`);
    await evaluate(`(${SWAP}[0].click(), 1)`);
    const CAND = `[...document.querySelectorAll('#rm-scenes [data-candidate], #rm-scene-edit [data-candidate], dialog[open] [data-candidate], [data-swap-pick], [role="listbox"] [role="option"]')].filter(e => ${SHOWN}(e))`;
    await waitFor(`${CAND}.length >= 1`, 4000, 'swap candidates ([data-candidate], [data-swap-pick] or listbox options)');
    await audit('review-swap-open', w);
    await evaluate(`(() => { const list = ${CAND}; const pick = list.find(e => e.getAttribute('aria-selected') !== 'true' && e.getAttribute('aria-checked') !== 'true') || list[list.length - 1]; pick.click(); return 1; })()`);
    await sleep(400);
    if (before) {
      const after = await ctx(`(c.state.photos[${JSON.stringify(before.id)}] || [])[0]`);
      expect(after && after !== before.media, `scene ${before.id} media did not change (${before.media} → ${after})`);
    }
  });
  await step('Review: Ask AI revises the reel', async () => {
    expect(await visible('#rm-revise'), 'Ask AI (#rm-revise) is not shown');
    await typeInto('#rm-ask-input', 'Lead with the 45 TD number');
    await evaluate(`(document.querySelector('#rm-ask').requestSubmit(), 1)`);
    await waitFor(`(window.ReelMakerCtx.state.plan.beats[0].text || '') === '45 TD. 6 INT.'`, 6000, 'the revised plan');
    const rv = calls.find(c => c.mode === 'revise');
    expect(rv && /45 TD/.test(rv.body.instruction), `revise instruction: ${rv && rv.body.instruction}`);
    expect((await ctx('c.state.plan.style')) === 'statcard', 'revise dropped the style');
  });
  await audit('review-revised', w);
  await step('Review: exactly three folds: Voice & music, Captions, Details', async () => {
    const folds = await evaluate(`[...document.querySelectorAll('#rm-pane-edit details')].filter(d => ${SHOWN}(d)).map(d => d.id + ':' + d.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim())`);
    const ids = folds.map(f => f.split(':')[0]);
    expect(ids.join() === 'rm-voice,rm-captions,rm-details', `folds: ${folds.join(' | ')}`);
    expect(/voice & music/i.test(folds[0]) && /captions/i.test(folds[1]) && /details/i.test(folds[2]), `fold titles: ${folds.join(' | ')}`);
  });
  for (const fold of ['#rm-voice', '#rm-captions', '#rm-details']) {
    if (!(await visible(fold))) continue;
    await openFold(fold);
    await audit(`review-fold-${fold.slice(4)}`, w);
    await openFold(fold, false);
  }
  await step('Review: admin-only controls stay hidden for a non-admin', async () => {
    const admin = await ctx(`Boolean(c.state.admin || c.state.isAdmin || (c.state.config && c.state.config.admin))`);
    if (admin) return;
    const shown = await evaluate(`[...document.querySelectorAll('[data-admin]')].filter(e => ${SHOWN}(e)).map(e => e.id || e.className)`);
    expect(!shown.length, `admin controls shown: ${shown.join(', ')}`);
  });
  await step('Review: no old UI', async () => { const old = await oldShown(); expect(!old.length, `old UI shown: ${old.join(', ')}`); });

  if (first) {
    await step('stage: scrubber keys and its spoken value', async () => {
      await evaluate(`(window.ReelMakerCtx.seek(0), document.querySelector('#rm-scrub').focus(), 1)`);
      const t = () => evaluate(`Math.round(window.ReelMakerCtx.state.t)`);
      await press('ArrowRight'); expect(await t() === 33, `one frame: ${await t()}`);
      await press('ArrowRight', { shift: true }); expect(await t() === 1033, `one second: ${await t()}`);
      await press('Home'); expect(await t() === 0, `Home: ${await t()}`);
      expect(/scene 1 of \d+/i.test(await evaluate(`document.querySelector('#rm-scrub').getAttribute('aria-valuetext')`)), 'scrubber valuetext');
    });
  }

  // Export.
  await step('Export step', async () => { await must('#rm-next'); await waitFor(`${SHOWN}(document.querySelector('#rm-pane-export'))`, 4000, 'Export step'); });
  await scrollTop();
  await audit('export-organic', w);
  await step('Export: one Export button plus Also export', async () => {
    const r = await evaluate(`({ exports: [...document.querySelectorAll('#rm-pane-export button')].filter(b => ${SHOWN}(b) && /^\\s*export\\b/i.test(b.textContent) && !b.closest('#rm-also')).length, primary: document.querySelector('#rm-export')?.matches('.es-btn--primary'), also: ${SHOWN}(document.querySelector('#rm-also')), alsoText: document.querySelector('#rm-also')?.textContent.replace(/\\s+/g, ' ') || '', target: ${SHOWN}(document.querySelector('#rm-target')), rights: ${SHOWN}(document.querySelector('#rm-rights, #rm-rights-table')) })`);
    expect(r.exports === 1, `${r.exports} Export buttons outside "Also export"`);
    expect(r.primary, '#rm-export is not the primary button');
    expect(r.also && /also export/i.test(r.alsoText), 'no "Also export" group');
    expect(/4:5/.test(r.alsoText) && /caption/i.test(r.alsoText), `Also export offers: ${r.alsoText}`);
    expect(r.target, 'no Organic / Paid toggle (#rm-target)');
    expect(r.rights, 'no rights summary');
  });
  if (first) {
    await step('Export MP4', async () => {
      await must('#rm-export');
      await waitFor(`!document.querySelector('#rm-files')?.hidden || /fail|cancel|fix/i.test(document.querySelector('#rm-export-status')?.textContent || '')`, 90000, 'exported file row');
      const st = await evaluate(`document.querySelector('#rm-export-status').textContent`);
      expect(/^Exported/.test(st), `export said: ${st}`);
    });
    await sleep(900);
    await audit('export-done', w);
    await step('Also export: captions offers SRT and VTT', async () => {
      await must('#rm-export-captions');
      await waitFor(`${SHOWN}(document.querySelector('#rm-captions-host'))`, 2000, 'the captions options');
      const t = await evaluate(`document.querySelector('#rm-captions-host').textContent`);
      expect(/srt/i.test(t) && /vtt/i.test(t), `captions host: ${t.slice(0, 80)}`);
    });
    await audit('export-captions', w);
  }
  await step('Paid ad', async () => { await must('#rm-target [data-target="paid"]'); await waitFor(`document.querySelector('#rm-target [data-target="paid"]').getAttribute('aria-checked') === 'true'`, 2000, 'paid picked'); });
  await audit('export-paid', w);

  // Every style makes a reel in its own style (first width only: the same page logic).
  if (first) {
    for (let i = 0; i < 4; i++) {
      const id = STYLE_IDS[i];
      await load();
      await step(`style ${id}: Make my reel → Review`, async () => {
        await makeReel({ style: id });
        expect((await ctx('c.state.plan.style')) === id, `plan.style ${await ctx('c.state.plan.style')}`);
        await waitFor(`/ready to post/i.test(document.querySelector('#rm-ready')?.textContent || '')`, 6000, '"Ready to post"');
        const sm = calls.find(c => c.mode === 'scene-media');
        expect(!sm || sm.body.style === id, `scene-media style ${sm && sm.body.style}`);
      });
      await scrollTop();
      await audit(`review-style-${id}`, w);
    }
  }

  // Script mode: the person's words, never rewritten.
  await load();
  const SCRIPT = 'The Cubs lost on Sunday. But one bar in Chicago got *paid.* Kalshi says 1 in 2,500 bets was insurance. Bettors put $692M on the games.';
  await step('script mode keeps the words', async () => {
    expect(await evaluate(`Boolean(document.querySelector('#rm-script-mode'))`), 'no "Use my exact words" switch (#rm-script-mode)');
    await makeReel({ style: 'receipts', text: SCRIPT, script: true });
    const vo = await ctx(`c.state.plan.beats.map(b => b.vo).filter(Boolean).join(' ')`);
    expect(vo === SCRIPT, `VO changed: ${vo}`);
  });
  await scrollTop();
  await audit('script-review', w);

  // Trends empty / error, free mode, server offline.
  Object.assign(scenario, { trends: 'empty' }); await load(); await sleep(400); await audit('create-trends-empty', w);
  Object.assign(scenario, { trends: 'error' }); await load(); await sleep(400); await audit('create-trends-error', w);
  Object.assign(scenario, { trends: 'ok', config: 'free' }); await load(); await sleep(600);
  await audit('free-create', w);
  await step('free mode make', async () => { await makeReel({ style: 'receipts', text: 'Shohei Ohtani hit 54 home runs and stole 59 bases this season, the first 50-50 season in MLB history.' }); });
  await scrollTop();
  await audit('free-review', w);
  Object.assign(scenario, { config: 'offline' }); await load(); await sleep(600);
  await audit('offline-create', w);
  await step('offline draft', async () => { await makeReel({ style: 'receipts', text: 'Scottie Scheffler closed with a 64 to win the Tour Championship by three shots.' }); });
  await scrollTop();
  await audit('offline-review', w);
  Object.assign(scenario, { config: 'ok' });
  if (Date.now() - t0 > 900000 && w !== WIDTHS[WIDTHS.length - 1]) { behaviour.push('time budget hit: some widths not swept'); break; }
}

cleanup();
const bad = results.filter(r => r.issues.length);
const warnTotal = results.reduce((n, r) => n + r.warns.length, 0);
for (const r of bad) console.log(`FAIL ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.issues)].join(' | ')}`);
for (const b of behaviour) console.log(`FAIL behaviour: ${b}`);
if (process.env.REELS_WARN) for (const r of results.filter(x => x.warns.length)) console.log(`warn ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.warns)].join(' | ')}`);
console.log(`reels ui: ${stateCount} states swept (${WIDTHS.join('/')} × light/dark), ${bad.length} with problems, ${behaviour.length} behaviour failures, ${warnTotal} off-grid spacing notes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || behaviour.length ? 1 : 0);
