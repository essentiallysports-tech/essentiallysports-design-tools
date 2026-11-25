// Merch Designs UI check: drives merch.html in real headless Chrome through
// the whole flow (Content → Designs → Setup → Push & live) against a mocked
// /api/merch (the replies in merch-demo.js), then the page-level states (free
// mode, not set up, can't push, errors). Desktop only: 1440 light and dark
// (full flow) plus 1024 light. Merch v2: the blank picker (tee / hoodie /
// poster / sticker / mug) with per-kind print checks, shop collections in
// Setup and on the live panel (with "New collection"), Archive with a typed
// confirm, the "Your merch" list (status, link, mockup, 30-day units and
// revenue, refresh) and the upload relay (direct PUT blocked → Supabase
// Storage merch-art/<user>/<file>.png → upload-relay). Fails on: horizontal scroll,
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
const bodies = [];
const stored = [];
let scenario = 'ok';
let blockPut = false;
const { server, base } = await startServer({
  api: (req, url, body) => {
    if (url.pathname === '/api/merch') {
      calls.push(body?.mode);
      bodies.push(body || {});
      const [status, data] = DEMO.reply(body || {}, scenario);
      // A blocked direct upload (CORS): the PUT to this host fails in the browser.
      if (body?.mode === 'upload-url' && blockPut) data.uploadUrl = 'https://upload.blocked.example/put';
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.g|favicon|merch-(rules|print)\.js|\/api\/merch|blocked\.example/.test(m.params.entry.url || '') && !/merch-(rules|print)\.js/.test(m.params.entry.text)) errors.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''));
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    const u = request.url;
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) send('Fetch.continueRequest', { requestId });
    else if (/blocked\.example/.test(u)) send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    else if (/\/storage\/v1\/object\//.test(u) && request.method !== 'OPTIONS') {
      const key = decodeURIComponent(u.split('/storage/v1/object/')[1].split('?')[0]);
      stored.push(key);
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify({ Id: 'obj-1', Key: key })).toString('base64') });
    }
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
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push("horizontal scroll " + document.documentElement.scrollWidth + " " + [...document.querySelectorAll("#main *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => e.tagName + "." + String(e.className).slice(0, 30)).join(" | "));
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
  main.querySelectorAll('h1,h2,h3,p,span,label,button').forEach(e => { if (vis(e) && !e.closest('.es-sr-only') && getComputedStyle(e).overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') out.push('clipped: ' + e.textContent.trim().slice(0, 30)); });
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
  ok(await evaluate("MerchUI.state.concepts[0].stack.slice(1).some(r => r.size === 'mid' || r.size === 'small')"), `${tag}: pill sizes`);
  // v3: variations, close-up / tee cards
  const nBefore = await evaluate("MerchUI.state.concepts.length");
  await click('.mx-design [data-act="vary"]');
  ok(await evaluate(`MerchUI.state.concepts.length > ${nBefore} && MerchUI.state.concepts.some(c => c.variantOf)`), `${tag}: variations added`);
  ok(await evaluate("document.querySelectorAll('.mx-design.is-variant').length >= 3"), `${tag}: variation cards`);
  await click('[data-card-view="tee"]');
  ok(await evaluate("MerchUI.state.cardView === 'tee'"), `${tag}: tee view`);
  await click('[data-card-view="closeup"]');
  ok(await evaluate("MerchUI.state.cardView === 'closeup'"), `${tag}: close-up view`);
  await click('.mx-design [data-act="align"]');
  await click('.mx-design [data-act="garment"][data-color="#101114"]');
  ok(await evaluate("MerchUI.state.concepts[0].garment.color === '#101114'"), `${tag}: garment colour`);
  await audit(`${tag}-designs`);
  await click('#mx-to-setup');
  await until("!document.getElementById('mx-view-setup').hidden && document.querySelectorAll('#mx-blanks [data-tpl]').length === 5 && document.getElementById('mx-price').value", `${tag} setup`);
  ok(await evaluate("[...document.querySelectorAll('#mx-blanks [data-kind]')].map(b => b.dataset.kind).join() === 'tee,hoodie,poster,sticker,mug'"), `${tag}: five blanks in order`);
  ok(await evaluate("document.querySelector('#mx-blanks [aria-checked=true]').dataset.kind === 'tee'"), `${tag}: starts on the tee`);
  ok(calls.includes('templates') && calls.includes('copy'), `${tag}: templates + copy called`);
  ok(await evaluate("/earn about/.test(document.getElementById('mx-earn').textContent)"), `${tag}: earnings line`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Left sleeve|Right sleeve|No logo'"), `${tag}: logo areas listed`);
  ok(await evaluate("document.getElementById('mx-logo').value === 'sleeve_left'"), `${tag}: logo defaults to the first logo area`);
  ok(await evaluate("MerchUI.state.colors.join() === 'Black'"), `${tag}: tee colour follows the design (${await evaluate('MerchUI.state.colors.join()')})`);
  ok(await evaluate("document.querySelectorAll('#mx-checks li').length >= 4 && !document.querySelector('#mx-checks .mx-check-row--error')"), `${tag}: tee print check, no problems`);
  // ── Blank picker: each kind has its own area, logo spot, price and checks.
  await click('#mx-blanks [data-kind="mug"]');
  await until("/Mug$/.test(document.getElementById('mx-title-input').value)", `${tag} mug copy`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Inside the design (small ES pill at the bottom)|No logo'"), `${tag}: mug logo goes under the design`);
  ok(await evaluate("document.getElementById('mx-colors-block').hidden"), `${tag}: one-colour blank hides the colour picker`);
  ok(await evaluate("Number(document.getElementById('mx-price').value) === 15.99 && /suggested \\$15\\.99/.test(document.getElementById('mx-earn').textContent)"), `${tag}: mug price + suggestion (${await evaluate("document.getElementById('mx-price').value")})`);
  ok(await evaluate("/handle/.test(document.getElementById('mx-checks').textContent) && /300 DPI/.test(document.getElementById('mx-checks').textContent)"), `${tag}: mug wrap + 300 DPI checks`);
  ok(await evaluate("/300 DPI/.test(document.getElementById('mx-side').textContent)"), `${tag}: print area shows its DPI`);
  // Sizes come from the template's printSpec (register rejects any other size).
  ok(await evaluate("(() => { const t = MerchUI.state.templates.find(x => x.kind === 'mug'); return /2700 × 1050 px at 300 DPI/.test(document.getElementById('mx-checks').textContent) && t.printSpec.pixelsWidth === 2700; })()"), `${tag}: mug draws at the template's 2700 × 1050`);
  await until("/Mug preview, ES logo inside the design/.test(document.getElementById('mx-stage-canvas').getAttribute('aria-label'))", `${tag}: mug preview label`);
  await audit(`${tag}-setup-mug`);
  await click('#mx-blanks [data-kind="sticker"]');
  await until("/cut line/.test(document.getElementById('mx-checks').textContent)", `${tag} sticker cut check`);
  await click('#mx-blanks [data-kind="poster"]');
  await until("/trim/.test(document.getElementById('mx-checks').textContent)", `${tag} poster trim check`);
  await audit(`${tag}-setup-poster`);
  await click('#mx-blanks [data-kind="hoodie"]');
  await until("/Hoodie$/.test(document.getElementById('mx-title-input').value) && document.getElementById('mx-colors-label').textContent === 'Hoodie colour'", `${tag} hoodie`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Left sleeve|Back neck|No logo'"), `${tag}: hoodie logo areas`);
  await click('#mx-blanks [data-kind="tee"]');
  await until("/Tee$/.test(document.getElementById('mx-title-input').value) && document.getElementById('mx-logo').value === 'sleeve_left'", `${tag} back to tee`);
  await click('#mx-colors [data-color="Navy"]');
  ok(await evaluate("MerchUI.state.colors.join() === 'Navy' && document.querySelectorAll('#mx-colors [aria-checked=true]').length === 1"), `${tag}: one tee colour at a time`);
  // ── Shop collections in Setup: tick one, then make a new one.
  await until("document.querySelectorAll('[data-colls=setup] [data-coll-id]').length >= 3", `${tag} setup collections`);
  await click('[data-colls=setup] [data-coll-id="col_fan"]');
  await click('[data-colls=setup] [data-coll-act="new"]');
  await until("document.querySelector('[data-coll-name=setup]')", `${tag} new collection field`);
  const collName = `QA drop ${tag}`;
  await evaluate(`(() => { const i = document.querySelector('[data-coll-name=setup]'); i.value = ${JSON.stringify(collName)}; return true; })()`);
  await click('[data-colls=setup] [data-coll-act="add"]');
  await until(`[...document.querySelectorAll('[data-colls=setup] .mx-cchip')].some(l => l.textContent.includes(${JSON.stringify(collName)}) && l.querySelector('input').checked)`, `${tag} new collection ticked`);
  ok(calls.includes('collections') && calls.includes('collection-create'), `${tag}: collections + collection-create called`);
  ok(await evaluate("MerchUI.state.pick.setup.length === 2"), `${tag}: two collections picked`);
  ok(await evaluate("document.getElementById('mx-to-live').disabled"), `${tag}: Continue waits for the rights tick`);
  await click('#mx-ack');
  ok(!(await evaluate("document.getElementById('mx-to-live').disabled")), `${tag}: tick enables Continue`);
  calls.length = 0;
  bodies.length = 0;
  stored.length = 0;
  blockPut = theme === 'dark'; // dark run: the direct upload is blocked, so the relay carries it
  await click('#mx-preview');
  await until("document.querySelectorAll('#mx-mockups img').length > 0", `${tag} mockups`, 15000);
  ok(calls.filter(c => c === 'upload-url').length === 2 && calls.includes('register') && calls.includes('preview'), `${tag}: print + logo uploaded, preview asked (${calls.join(',')})`);
  if (blockPut) {
    const relays = bodies.filter(b => b.mode === 'upload-relay');
    ok(relays.length === 2, `${tag}: relay used for both files (${relays.length})`);
    ok(stored.length === 2 && stored.every(k => /^merch-art\/00000000-0000-0000-0000-000000000001\/[\w-]+\.png$/.test(k)), `${tag}: files went to merch-art/<user>/<file>.png (${stored.join(' ')})`);
    ok(relays.every(b => b.bucket === 'merch-art' && /^00000000-0000-0000-0000-000000000001\//.test(b.path) && /blocked\.example/.test(b.uploadUrl) && b.size > 0), `${tag}: relay gets path, uploadUrl and size`);
  }
  blockPut = false;
  await audit(`${tag}-setup`);
  await click('#mx-to-live');
  await until("!document.getElementById('mx-view-live').hidden && /Navy/.test(document.getElementById('mx-push-status').textContent)", `${tag} live view`);
  await audit(`${tag}-push`);
  calls.length = 0;
  await click('#mx-create-fw');
  await until("!document.getElementById('mx-live').hidden && document.querySelector('#mx-live img')", `${tag} product`);
  ok(calls.includes('create') && !calls.includes('upload-url'), `${tag}: create reuses the uploaded images (${calls.join(',')})`);
  const setCall = bodies.filter(b => b.mode === 'collection-set').pop();
  ok(setCall && setCall.collectionIds.length === 2 && setCall.collectionIds.includes('col_fan'), `${tag}: create puts it in the picked collections`);
  ok(await evaluate("document.querySelectorAll('[data-colls=live] [data-coll-id]:checked').length === 2"), `${tag}: live panel shows its collections`);
  ok(await evaluate("Boolean(document.querySelector('#mx-live [data-live=copy-desc]'))"), `${tag}: copy description backup`);
  ok(await evaluate("/Hidden/.test(document.querySelector('#mx-live .es-badge').textContent)"), `${tag}: created hidden`);
  ok(await evaluate("/Fourthwall dashboard/.test(document.getElementById('mx-live').textContent)"), `${tag}: edit-on-Fourthwall note`);
  await audit(`${tag}-live`);
  await click('#mx-live [data-live="publish"]');
  await until("/Live/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} publish`);
  await click('#mx-live [data-live="hide"]');
  await until("/Hidden/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} hide`);
  // ── Collections on the live panel: untick one, save.
  ok(await evaluate("document.querySelector('[data-coll-act=save]').disabled"), `${tag}: save waits for a change`);
  await click('[data-colls=live] [data-coll-id="col_fan"]');
  await click('[data-coll-act="save"]');
  await until("/Saved/.test(document.querySelector('[data-coll-status=live]')?.textContent || '')", `${tag} live collections saved`);
  ok(bodies.filter(b => b.mode === 'collection-set').pop().collectionIds.length === 1, `${tag}: live save sends the new list`);
  // ── Archive with a typed confirm.
  await click('#mx-live [data-live="archive"]');
  await until("document.getElementById('mx-archive').open", `${tag} archive dialog`);
  ok(await evaluate("document.getElementById('mx-archive-go').disabled && document.activeElement.id === 'mx-archive-input'"), `${tag}: archive waits for the name, focus in the field`);
  await evaluate("(() => { const i = document.getElementById('mx-archive-input'); i.value = 'wrong name'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(await evaluate("document.getElementById('mx-archive-go').disabled"), `${tag}: a wrong name keeps Archive off`);
  await evaluate("(() => { const i = document.getElementById('mx-archive-input'); i.value = '  ' + MerchUI.state.product.name.toLowerCase() + ' '; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(!(await evaluate("document.getElementById('mx-archive-go').disabled")), `${tag}: the typed name enables Archive`);
  await audit(`${tag}-archive-dialog`);
  await click('#mx-archive-go');
  await until("!document.getElementById('mx-archive').open && /Archived/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} archived`);
  const arch = bodies.filter(b => b.mode === 'archive').pop();
  ok(arch && arch.confirm === true && arch.productId && arch.confirmName.toLowerCase() === arch.confirmName && arch.confirmName.length > 3, `${tag}: archive sends confirm:true and the typed name`);
  ok(await evaluate("!document.querySelector('#mx-live [data-live=publish], #mx-live [data-live=hide], #mx-live [data-live=archive]')"), `${tag}: archived product has no actions`);
  // ── Your merch.
  calls.length = 0;
  await click('#mx-tab-list');
  await until("!document.getElementById('mx-view-list').hidden && document.querySelectorAll('#mx-list tbody tr').length >= 5", `${tag} list`);
  ok(calls.includes('list') && calls.includes('sales'), `${tag}: list + sales called`);
  ok(await evaluate("document.getElementById('mx-steps-nav').hidden && document.getElementById('mx-tab-list').getAttribute('aria-selected') === 'true'"), `${tag}: list tab selected, steps hidden`);
  ok(await evaluate("(() => { const r = document.querySelector('#mx-list tr[data-pid=prod_s1]'); return r && /Live/.test(r.textContent) && /364\\.00/.test(r.textContent) && r.querySelector('img') && r.querySelector('a[href*=ball-dont-lie]'); })()"), `${tag}: row has status, revenue, mockup and link`);
  ok(await evaluate("document.querySelectorAll('#mx-list-totals .mx-total').length === 4"), `${tag}: totals`);
  ok(await evaluate("/Sales updated/.test(document.getElementById('mx-list-updated').textContent)"), `${tag}: sales time`);
  await audit(`${tag}-list`);
  calls.length = 0;
  await click('#mx-list tr[data-pid=prod_s2] [data-row=refresh]');
  await until("/up to date/.test(document.getElementById('mx-list-updated').textContent)", `${tag} row refresh`);
  ok(bodies.filter(b => b.mode === 'product').pop()?.refresh === true, `${tag}: row refresh asks product with refresh:true`);
  await click('#mx-list tr[data-pid=prod_s2] [data-row=archive]');
  await until("document.getElementById('mx-archive').open && /Megatron/.test(document.getElementById('mx-archive-name').textContent)", `${tag} list archive dialog`);
  await click('#mx-archive-cancel');
  ok(await evaluate("!document.getElementById('mx-archive').open && document.activeElement?.dataset.row === 'archive'"), `${tag}: cancel closes and returns focus`);
  calls.length = 0;
  await click('#mx-list-refresh');
  await until("document.getElementById('mx-list').getAttribute('aria-busy') === 'false' && document.querySelectorAll('#mx-list tbody tr').length >= 5", `${tag} list refresh`);
  ok(calls.includes('list'), `${tag}: refresh reloads the list`);
  await click('#mx-tab-make');
  ok(await evaluate("!document.getElementById('mx-view-live').hidden"), `${tag}: Create tab returns to the last step`);
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
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'We center fans'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-create');
  await until("document.querySelectorAll('.mx-design').length > 0", `${tag} free designs (fallback concepts)`);
  await until("/Free mode/.test(document.getElementById('mx-banner').textContent)", `${tag} free banner`);
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

  scenario = 'cap';
  await load(width, theme, 'cap');
  await evaluate("(() => { const t = document.getElementById('mx-text'); t.value = 'Ball don’t lie'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-create');
  await until("document.querySelectorAll('.mx-design').length > 0", `${tag} cap designs`);
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cap setup`);
  await click('#mx-ack');
  await click('#mx-to-live');
  await click('#mx-create-fw');
  await until("/daily limit/.test(document.getElementById('mx-push-status').textContent)", `${tag} daily cap message`);
  await audit(`${tag}-cap`);

  // Your merch: history not set up (Fourthwall fallback), empty, error.
  scenario = 'no-db';
  await load(width, theme, 'nodb');
  await click('#mx-tab-list');
  await until("!document.getElementById('mx-list-source').hidden && document.querySelectorAll('#mx-list tbody tr').length > 0", `${tag} list from Fourthwall`);
  scenario = 'empty-list';
  await load(width, theme, 'empty');
  await click('#mx-tab-list');
  await until("document.querySelector('#mx-list .es-empty')", `${tag} empty list`);
  await audit(`${tag}-list-empty`);
  await click('#mx-list [data-list-act=make]');
  ok(await evaluate("!document.getElementById('mx-view-content').hidden"), `${tag}: empty list sends you to create`);

  scenario = 'error';
  await load(width, theme, 'err');
  await click('#mx-tab-list');
  await until("document.querySelector('#mx-list .es-error-state [data-list-act=retry]')", `${tag} list error with retry`);
  await audit(`${tag}-list-error`);
  await click('#mx-tab-make');
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
  await states(1440, 'dark');
  // Desktop only, but no horizontal scroll on a phone: the list view at 375.
  scenario = 'ok';
  await load(375, 'light', 'phone');
  await click('#mx-tab-list');
  await until("document.querySelectorAll('#mx-list tbody tr').length > 0", '375 list');
  await audit('375-light-list');
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
console.log(`merch ui: ${checks} checks passed (1440 light + dark, 1024 light; flow, blanks, collections, archive, list, relay and states)`);
