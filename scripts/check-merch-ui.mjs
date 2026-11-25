// Merch Designs UI check: drives merch.html in real headless Chrome through
// the whole flow (Content → Designs → Setup → Push & live) against a mocked
// /api/merch (the replies in merch-demo.js), then the page-level states (free
// mode, not set up, can't push, errors). Desktop only: 1440 light (full flow)
// plus 1440 dark and 1024 light (main views). Fails on: horizontal scroll,
// more than one primary button in view, unlabelled controls, broken images,
// console errors / exceptions, and any step that doesn't do what it says.
// No AI, no Fourthwall, no Supabase: every external request is answered locally.
// Run: node scripts/check-merch-ui.mjs   (MX_SHOTS=dir saves screenshots)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('merch ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('merch ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHOTS = process.env.MX_SHOTS ? path.resolve(process.env.MX_SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const DEMO = (() => { const box = {}; new Function('self', fs.readFileSync(path.join(ROOT, 'merch-demo.js'), 'utf8'))(box); return box.MerchDemo; })();
const calls = [];
let scenario = 'ok';
const { server, base } = await startServer({
  api: (req, url, body) => {
    if (url.pathname === '/api/merch') {
      calls.push(body?.mode);
      const [status, data] = DEMO.reply(body || {}, scenario);
      return { status, body: data };
    }
    if (url.pathname === '/api/trend-design') return { status: 200, body: { ok: true, items: DEMO.TRENDS } };
    if (url.pathname === '/api/ai-status') return { status: 200, body: { ok: true, mode: 'ai' } };
    return null;
  },
  extra: url => (url.pathname === '/__qa/upload' ? { type: 'text/plain', body: '' } : null),
});
const chrome = await startChrome(CHROME);
const { send, evaluate } = chrome;
const errors = [];
const FIXTURE = fs.readFileSync(path.join(ROOT, 'how-step-review.webp'));
chrome.on(m => {
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  // merch-rules.js / merch-print.js may not exist on this branch yet: a 404 there is expected.
  // /api/merch 4xx / 5xx are the error states under test.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.g|favicon|merch-(rules|print)\.js|\/api\/merch/.test(m.params.entry.url || '') && !/merch-(rules|print)\.js/.test(m.params.entry.text)) errors.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''));
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    const u = request.url;
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) send('Fetch.continueRequest', { requestId });
    else if (request.method === 'OPTIONS') send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' }], body: '' });
    else if (/\.(png|webp|jpe?g)(\?|$)/i.test(u)) send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/webp' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: FIXTURE.toString('base64') });
    else send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('null').toString('base64') });
  }
});
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });

const fails = [];
let checks = 0;
const ok = (cond, what) => { checks += 1; if (!cond) fails.push(what); };
async function until(expr, what, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { if (await evaluate(expr).catch(() => false)) return true; await sleep(100); }
  fails.push('timed out: ' + what);
  return false;
}
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);

async function load(width, theme, state = '') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/__blank` });
  await sleep(200);
  await evaluate(FAKE_SESSION);
  await evaluate("sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); true");
  await send('Page.navigate', { url: `${base}/merch.html?demo=off${state ? `&x=${state}` : ''}` });
  await until("document.querySelector('#mx-collections [role=radio]') && document.documentElement.style.visibility !== 'hidden'", 'page ready', 15000);
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(s); window.FrameUpTheme?.apply ? window.FrameUpTheme.apply(${JSON.stringify(theme)}) : (document.documentElement.dataset.theme = ${JSON.stringify(theme)}); return true; })()`);
  await sleep(300);
}

const AUDIT = `(() => {
  const out = [];
  const vis = e => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0;
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('horizontal scroll ' + document.documentElement.scrollWidth);
  const main = document.getElementById('main');
  const inView = e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < document.documentElement.scrollHeight; };
  const prim = [...main.querySelectorAll('.es-btn--primary')].filter(e => vis(e) && inView(e));
  if (prim.length > 1) out.push('primary buttons: ' + prim.length);
  main.querySelectorAll('button,a[href],input,select,textarea,[role=radio]').forEach(e => {
    if (!vis(e) || e.closest('[aria-hidden=true]')) return;
    const name = (e.getAttribute('aria-label') || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || (['INPUT','SELECT','TEXTAREA'].includes(e.tagName) ? '' : e.textContent) || e.title || '').trim();
    if (!name) out.push('no name: ' + e.tagName + '#' + e.id + '.' + e.className);
  });
  main.querySelectorAll('img').forEach(i => { if (vis(i) && i.complete && i.naturalWidth === 0) out.push('broken image ' + i.src.slice(-40)); });
  main.querySelectorAll('h1,h2,h3,p,span,label,button').forEach(e => { if (vis(e) && getComputedStyle(e).overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') out.push('clipped: ' + e.textContent.trim().slice(0, 30)); });
  const fam = getComputedStyle(main).fontFamily.split(',')[0].replace(/["']/g, '');
  if (!/roboto|acumin/i.test(fam)) out.push('font ' + fam);
  return out;
})()`;
async function audit(tag) {
  const found = await evaluate(AUDIT);
  found.forEach(f => fails.push(`${tag}: ${f}`));
  checks += 1;
  if (SHOTS) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, `merch-${tag}.png`), Buffer.from(r.result.data, 'base64'));
  }
}

// ─── Full flow at 1440, light ─────────────────────────────────────────────
async function flow(width, theme) {
  const tag = `${width}-${theme}`;
  scenario = 'ok';
  calls.length = 0;
  await load(width, theme);
  await until("/connected/i.test(document.getElementById('mx-conn').textContent)", `${tag} status`);
  ok(await evaluate("document.getElementById('mx-create').disabled"), `${tag}: Create designs starts disabled`);
  await click('#mx-trends-load');
  await until("document.querySelectorAll('#mx-trends [data-trend]').length === 3", `${tag} trends`);
  await click('#mx-trends [data-trend]');
  ok(await evaluate("document.getElementById('mx-text').value.length > 5"), `${tag}: a trend fills the text`);
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'Ball don’t lie'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('[data-coll="quote"]');
  ok(await evaluate("document.querySelector('[data-coll=quote]').getAttribute('aria-checked') === 'true'"), `${tag}: collection picks`);
  await audit(`${tag}-content`);
  await click('#mx-create');
  await until("!document.getElementById('mx-view-designs').hidden && document.querySelectorAll('.mx-design').length === 4", `${tag} designs`);
  ok(calls.includes('concepts'), `${tag}: concepts called`);
  ok(await evaluate("document.querySelectorAll('.mx-design .mx-rchip').length > 0"), `${tag}: rights chips on cards`);
  // Quick edits on the first card: swap colours, edit a pill, big/small, align, garment.
  const before = await evaluate("JSON.stringify(MerchUI.state.concepts[0].palette)");
  await click('.mx-design [data-act="swap"]');
  ok(await evaluate(`JSON.stringify(MerchUI.state.concepts[0].palette) !== ${JSON.stringify(before)}`), `${tag}: swap colours`);
  await click('.mx-design [data-act="text"]');
  await until("document.querySelector('.mx-design [data-pill]')", `${tag} pill editor`);
  await evaluate("(() => { const i = document.querySelector('.mx-design [data-pill]'); i.value = 'KOBE!'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(await evaluate("MerchUI.state.concepts[0].stack[0].text === 'KOBE!'"), `${tag}: pill text edits`);
  await click('.mx-design [data-act="up"][data-i="1"]');
  ok(await evaluate("MerchUI.state.concepts[0].stack[1].text === 'KOBE!'"), `${tag}: pill order`);
  await click('.mx-design [data-act="size"]');
  ok(await evaluate("MerchUI.state.concepts[0].stack.some(r => r.size === 'small')"), `${tag}: big / small`);
  await click('.mx-design [data-act="align"]');
  await click('.mx-design [data-act="garment"][data-color="#101114"]');
  ok(await evaluate("MerchUI.state.concepts[0].garment.color === '#101114'"), `${tag}: garment colour`);
  await audit(`${tag}-designs`);
  await click('#mx-to-setup');
  await until("!document.getElementById('mx-view-setup').hidden && document.querySelectorAll('#mx-blanks [data-tpl]').length === 2 && document.getElementById('mx-price').value", `${tag} setup`);
  ok(calls.includes('templates') && calls.includes('copy'), `${tag}: templates + copy called`);
  ok(await evaluate("/earn about/.test(document.getElementById('mx-earn').textContent)"), `${tag}: earnings line`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Left sleeve|Right sleeve|Back neck|Neck label|No logo'"), `${tag}: logo areas listed`);
  ok(await evaluate("document.getElementById('mx-logo').value === 'back-neck'"), `${tag}: logo defaults to back neck`);
  ok(await evaluate("document.getElementById('mx-to-live').disabled"), `${tag}: Continue waits for the rights tick`);
  await click('#mx-ack');
  ok(!(await evaluate("document.getElementById('mx-to-live').disabled")), `${tag}: tick enables Continue`);
  calls.length = 0;
  await click('#mx-preview');
  await until("document.querySelectorAll('#mx-mockups img').length > 0", `${tag} mockups`);
  ok(calls.filter(c => c === 'upload-url').length === 2 && calls.includes('register') && calls.includes('preview'), `${tag}: print + logo uploaded, preview asked (${calls.join(',')})`);
  await audit(`${tag}-setup`);
  await click('#mx-to-live');
  await until("!document.getElementById('mx-view-live').hidden && document.querySelector('.mx-list__row')", `${tag} live view`);
  await audit(`${tag}-push`);
  calls.length = 0;
  await click('#mx-create-fw');
  await until("!document.getElementById('mx-live').hidden && document.querySelector('#mx-live .es-table')", `${tag} product`);
  ok(calls.includes('create') && !calls.includes('upload-url'), `${tag}: create reuses the uploaded images (${calls.join(',')})`);
  ok(await evaluate("/Hidden/.test(document.querySelector('#mx-live .es-badge').textContent)"), `${tag}: created hidden`);
  ok(await evaluate("/Fourthwall dashboard/.test(document.getElementById('mx-live').textContent)"), `${tag}: edit-on-Fourthwall note`);
  await audit(`${tag}-live`);
  await click('#mx-live [data-live="publish"]');
  await until("/Live/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} publish`);
  await click('#mx-live [data-live="archive"]');
  ok(await evaluate("/can’t be undone/.test(document.getElementById('mx-live').textContent)"), `${tag}: archive asks first`);
  await click('#mx-live [data-live="archive"]');
  await until("document.getElementById('mx-live').hidden", `${tag} archive`);
}

// ─── Page states ──────────────────────────────────────────────────────────
async function states(width, theme) {
  const tag = `${width}-${theme}`;
  scenario = 'not-set-up';
  await load(width, theme, 'nsu');
  await until("/FOURTHWALL_API_USERNAME/.test(document.getElementById('mx-banner').textContent)", `${tag} not-set-up banner`);
  await audit(`${tag}-not-set-up`);

  scenario = 'free';
  await load(width, theme, 'free');
  await until("/Free mode/.test(document.getElementById('mx-banner').textContent)", `${tag} free banner`);
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'We center fans'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-create');
  await until("document.querySelectorAll('.mx-design').length > 0", `${tag} free designs (fallback concepts)`);
  ok(await evaluate("/without AI/.test(document.getElementById('mx-designs-sub').textContent)"), `${tag}: free-mode note`);

  scenario = 'cant-push';
  await load(width, theme, 'cp');
  await until("MerchUI.state.status", `${tag} cant-push status`);
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'Ball don’t lie'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-create');
  await until("document.querySelectorAll('.mx-design').length > 0", `${tag} cp designs`);
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cp setup`);
  await click('#mx-ack');
  await click('#mx-to-live');
  await until("/Ask an admin to publish this/.test(document.getElementById('mx-push-status').textContent)", `${tag} can't-push message`);
  ok(await evaluate("document.getElementById('mx-create-fw').disabled"), `${tag}: create disabled for non-pushers`);
  await audit(`${tag}-cant-push`);

  scenario = 'error';
  await load(width, theme, 'err');
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'Ball don’t lie'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-create');
  await until("document.querySelectorAll('.mx-design').length > 0", `${tag} error → fallback designs`);
  await click('#mx-to-setup');
  await until("document.querySelector('#mx-blanks-retry')", `${tag} templates error with retry`);
  await audit(`${tag}-error`);
}

try {
  await flow(1440, 'light');
  await flow(1440, 'dark');
  await flow(1024, 'light');
  await states(1440, 'light');
} catch (error) {
  fails.push('crashed: ' + error.message);
}
chrome.close();
server.close();
errors.forEach(e => fails.push(e));
if (fails.length) {
  console.log(`merch ui: ${fails.length} problem(s) in ${checks} checks`);
  [...new Set(fails)].forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`merch ui: ${checks} checks passed (1440 light + dark, 1024 light; flow and states)`);
