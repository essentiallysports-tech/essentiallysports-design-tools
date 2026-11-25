// Merch Designs UI check: drives merch.html in real headless Chrome through
// the whole flow (Content → Design studio → Product → Push & live) against a
// mocked /api/merch (the replies in merch-demo.js), then the page-level states.
// Desktop only: 1440 light (Pro) and dark (Pro, upload relay) plus 1024 light
// (Basic). Merch v4: the Basic / Pro switch (remembered), merch-worthy moments
// (sport filter, "Design this" fills the brief and sends the trend), the "AI
// follows ES merch rules" disclosure, the studio (stage On a tee = Fourthwall
// blank photo / Close-up, filmstrip with arrow keys, pill editor, size and
// layout, real tee colours, Pro extras, AI chat refine with history + undo,
// variations, inline print checks), the Product step (live mockups requested
// automatically for admins, "Update mockups" when out of date, gallery), shop
// collections, Archive with a typed confirm, Your merch, the upload relay
// (direct PUT blocked → Supabase Storage merch-art/<user>/<file>.png →
// upload-relay) and the states (free, Pro capped, not set up, can't push, daily
// cap, errors, no moments). Fails on: horizontal scroll, more than one primary
// button in view, unlabelled controls, broken images, console errors /
// exceptions, and any step that doesn't do what it says.
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
  extra: url => {
    if (url.pathname === '/__qa/upload') return { type: 'text/plain', body: '' };
    // merch-guidelines.js comes from the server lane; stand in for it until it's in this checkout.
    if (url.pathname === '/merch-guidelines.js' && !fs.existsSync(path.join(ROOT, 'merch-guidelines.js'))) return { type: 'text/javascript', body: "self.MerchGuidelines = { SUMMARY: ['ES pills only.', 'Your line comes first, word for word.', 'Numbers and quotes only from your story.'] };" };
    return null;
  },
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.g|favicon|merch-(rules|print|guidelines)\.js|\/api\/merch|blocked\.example/.test(m.params.entry.url || '') && !/merch-(rules|print)\.js/.test(m.params.entry.text)) errors.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''));
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

async function load(width, theme, state = '', mode = '') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/__blank` });
  await sleep(200);
  await evaluate(FAKE_SESSION);
  await evaluate(`(() => { ${mode ? `localStorage.setItem('frameup.merch.aiMode', ${JSON.stringify(mode)})` : "localStorage.removeItem('frameup.merch.aiMode')"}; return true; })()`);
  await evaluate("sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); true");
  await send('Page.navigate', { url: `${base}/merch.html?demo=off${state ? `&x=${state}` : ''}` });
  await until("document.querySelector('#mx-collections [role=radio]') && window.MerchUI && document.documentElement.style.visibility !== 'hidden'", 'page ready', 15000);
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

// ─── Full flow ────────────────────────────────────────────────────────────
const setText = (sel, v) => evaluate(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const sel = () => 'MerchUI.state.concepts.find(c => c.id === MerchUI.state.selected)';

async function flow(width, theme, mode) {
  const tag = `${width}-${theme}-${mode}`;
  const pro = mode === 'pro';
  scenario = 'ok';
  calls.length = 0;
  bodies.length = 0;
  await load(width, theme);
  await until("/connected/i.test(document.getElementById('mx-conn').textContent)", `${tag} status`);
  ok(await evaluate("document.getElementById('mx-create').disabled"), `${tag}: Create with AI starts disabled`);
  // ── Basic / Pro switch: Basic by default, remembered per person.
  ok(await evaluate("document.querySelector('#mx-mode [data-ai=basic]').getAttribute('aria-checked') === 'true' && MerchUI.state.aiMode === 'basic'"), `${tag}: Basic by default`);
  if (pro) {
    await click('#mx-mode [data-ai=pro]');
    ok(await evaluate("MerchUI.state.aiMode === 'pro' && localStorage.getItem('frameup.merch.aiMode') === 'pro' && /Smarter AI \\(more usage\\)/.test(document.getElementById('mx-mode-note').textContent)"), `${tag}: Pro picked, explained and remembered`);
  }
  // ── Rules disclosure (MerchGuidelines.SUMMARY).
  ok(await evaluate("!document.getElementById('mx-rules').hidden && document.querySelectorAll('#mx-rules-list li').length >= 3"), `${tag}: the AI-rules disclosure lists the ES rules`);
  // ── Moments.
  await until("document.querySelectorAll('#mx-moments .mx-moment[data-mid]').length === 5", `${tag} moments`);
  ok(calls.includes('moments'), `${tag}: moments called`);
  ok(await evaluate("(() => { const m = document.querySelector('#mx-moments [data-mid=m1]'); return /Stat/.test(m.textContent) && /91/.test(m.textContent) && /FIFTY ON THE NIGHT/.test(m.textContent) && /NBA/.test(m.textContent) && /round number/.test(m.textContent); })()"), `${tag}: moment card has kind, score, line, sport and why`);
  await click('#mx-moments-sports [data-sport="NFL"]');
  ok(await evaluate("document.querySelectorAll('#mx-moments [data-mid]').length === 1"), `${tag}: sport filter`);
  await click('#mx-moments-sports [data-sport=""]');
  await click('#mx-moments [data-design="m2"]');
  ok(await evaluate("document.getElementById('mx-text').value === 'BALL DON’T LIE' && document.querySelector('[data-coll=quote]').getAttribute('aria-checked') === 'true' && !document.getElementById('mx-using').hidden"), `${tag}: Design this fills the brief, picks the collection, shows the moment`);
  ok(!(await evaluate("document.getElementById('mx-create').disabled")), `${tag}: Create with AI enabled`);
  await audit(`${tag}-content`);
  await click('#mx-create');
  await until("!document.getElementById('mx-view-designs').hidden && document.querySelectorAll('#mx-strip .mx-film').length >= 4", `${tag} studio`);
  const cBody = bodies.filter(b => b.mode === 'concepts').pop();
  ok(cBody && cBody.designMode === mode && cBody.trend?.id === 't4' && cBody.collection === 'quote' && cBody.content?.text === 'BALL DON’T LIE', `${tag}: concepts gets designMode, trend, collection, content (${JSON.stringify(cBody).slice(0, 160)})`);
  ok(await evaluate(`document.getElementById('mx-made-mode').textContent === ${JSON.stringify(pro ? 'Made with Pro' : 'Made with Basic')}`), `${tag}: shows the mode used`);
  ok(await evaluate("!document.getElementById('mx-idea').hidden && document.getElementById('mx-idea-text').textContent.length > 10"), `${tag}: the AI plan (the idea)`);
  ok(await evaluate(`MerchUI.state.concepts.length === ${pro ? 6 : 4} && document.querySelectorAll('#mx-strip [role=radio]').length === MerchUI.state.concepts.length`), `${tag}: filmstrip has every design (${await evaluate('MerchUI.state.concepts.length')})`);
  ok(await evaluate("[...document.querySelectorAll('#mx-strip .mx-film')].every(b => b.querySelector('canvas').width > 0)"), `${tag}: thumbnails drawn`);
  // Filmstrip keyboard.
  await evaluate("document.querySelector('#mx-strip [aria-checked=true]').focus(); document.querySelector('#mx-strip [aria-checked=true]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true");
  ok(await evaluate("MerchUI.state.selected === MerchUI.state.concepts[1].id && document.activeElement === document.querySelector('#mx-strip [aria-checked=true]')"), `${tag}: arrow keys move through the filmstrip`);
  await click('#mx-strip .mx-film');
  // Stage: On a tee = Fourthwall's blank photo (templates load in the studio); Close-up.
  await until("MerchUI.state.templates && /blank photo/.test(document.getElementById('mx-stage-cap').textContent)", `${tag} stage on the blank photo`);
  ok(calls.includes('templates'), `${tag}: templates loaded for the studio`);
  await click('[data-stage=closeup]');
  await until("/Close-up/.test(document.getElementById('mx-stage-cap').textContent)", `${tag} close-up stage`);
  await click('[data-stage=tee]');
  // Tee colours are the template's real colours.
  ok(await evaluate("document.querySelectorAll('#mx-tee-colors [role=radio]').length === 5 && /Fourthwall/.test(document.getElementById('mx-tee-colors-note').textContent)"), `${tag}: real tee colours`);
  await click('#mx-tee-colors [data-name="Black"]');
  ok(await evaluate(`${sel()}.garment.name === 'Black' && MerchUI.state.colors.join() === 'Black'`), `${tag}: tee colour picks`);
  // ── Pill editor.
  await setText('#mx-pills [data-pill-text="0"]', 'KOBE!');
  ok(await evaluate(`${sel()}.stack[0].text === 'KOBE!'`), `${tag}: pill text edits`);
  await click('#mx-pills [data-pill-act="down"][data-i="0"]');
  ok(await evaluate(`${sel()}.stack[1].text === 'KOBE!'`), `${tag}: pill order`);
  await click('#mx-pills [data-pill-size="mid"][data-i="1"]');
  ok(await evaluate(`${sel()}.stack[1].size === 'mid'`), `${tag}: pill size`);
  await click('#mx-pills [data-pill-fill="black"][data-i="1"]');
  ok(await evaluate(`${sel()}.stack[1].fill === 'black'`), `${tag}: pill colour`);
  const nPills = await evaluate(`${sel()}.stack.length`);
  await click('#mx-pill-add');
  ok(await evaluate(`${sel()}.stack.length === ${nPills + 1}`), `${tag}: add a pill`);
  await click(`#mx-pills [data-pill-act="drop"][data-i="${nPills}"]`);
  ok(await evaluate(`${sel()}.stack.length === ${nPills}`), `${tag}: remove a pill`);
  await click('#mx-undo');
  ok(await evaluate(`${sel()}.stack.length === ${nPills + 1}`), `${tag}: undo brings the pill back`);
  // Size and layout moved here from Setup.
  await evaluate("(() => { const r = document.getElementById('mx-fit-scale'); r.value = 130; r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(await evaluate(`${sel()}.fit.scale === 1.3 && document.getElementById('mx-fit-scale-out').textContent === '130%' && /Prints/.test(document.getElementById('mx-fit-read').textContent)`), `${tag}: size slider`);
  await click('[data-fit-align="center"]');
  ok(await evaluate(`${sel()}.align === 'center'`), `${tag}: alignment`);
  await click('#mx-fit-reset');
  ok(await evaluate(`${sel()}.fit.scale === 1`), `${tag}: reset layout`);
  // ── AI chat refine with history and undo.
  await click('[data-fit-align="left"]');
  bodies.length = 0;
  await click('#mx-chat-chips [data-say="Centre it"]');
  await until(`${sel()}.align === 'center' && /Centred/.test(document.getElementById('mx-chat-note').textContent)`, `${tag} refine centre`);
  await click('#mx-chat-chips [data-say="Shorter"]');
  await until("/Dropped|Removed/.test(document.getElementById('mx-chat-note').textContent)", `${tag} refine shorter`);
  const rBody = bodies.filter(b => b.mode === 'refine').pop();
  ok(rBody && rBody.designMode === mode && rBody.instruction === 'Shorter' && JSON.stringify(rBody.history) === '["Centre it"]' && rBody.concept?.id && rBody.trend?.id === 't4', `${tag}: refine sends instruction, designMode, history and trend (${JSON.stringify(rBody?.history)})`);
  await setText('#mx-chat-input', 'use Lakers colours please');
  await click('#mx-chat-send');
  await until("/Lakers|colour/.test(document.getElementById('mx-chat-note').textContent) && !MerchUI.state.refining", `${tag} refine typed`);
  await click('#mx-chat-note [data-chat-undo]');
  await click('#mx-undo');
  ok(await evaluate(`${sel()}.align === 'center'`), `${tag}: undo steps back through AI edits`);
  await click('#mx-undo');
  ok(await evaluate(`${sel()}.align === 'left'`), `${tag}: undo reaches the design before the chat`);
  // ── Pro extras.
  if (pro) {
    const p1 = await evaluate("MerchUI.state.concepts.findIndex(c => c.id === 'p1')");
    await click('#mx-strip [data-id="p1"]');
    ok(p1 >= 0 && await evaluate("!document.getElementById('mx-elements-sec').hidden && document.querySelectorAll('#mx-elements .mx-el').length === 2"), `${tag}: Pro design lists its extras`);
    await click('#mx-el-add [data-el-add="icon"]');
    ok(await evaluate(`${sel()}.elements.length === 3 && ${sel()}.elements[2].type === 'icon' && document.querySelector('#mx-el-add [data-el-add=rule]').disabled`), `${tag}: add an icon, max 3`);
    await evaluate("(() => { const s = document.querySelector('#mx-elements [data-el=\"2\"] [data-el-field=name]'); s.value = 'trophy'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    ok(await evaluate(`${sel()}.elements[2].name === 'trophy'`), `${tag}: change the icon`);
    await click('#mx-elements [data-el-drop="0"]');
    ok(await evaluate(`${sel()}.elements.length === 2 && ${sel()}.elements[0].type === 'rule'`), `${tag}: remove an extra`);
    ok(await evaluate("document.querySelector('#mx-el-add [data-el-add=number]').disabled"), `${tag}: Number needs a number in the story`);
  } else {
    ok(await evaluate("document.getElementById('mx-elements-sec').hidden && MerchUI.state.concepts.every(c => !c.elements)"), `${tag}: Basic has no extras`);
  }
  // Variations.
  const nBefore = await evaluate('MerchUI.state.concepts.length');
  await click('#mx-vary');
  ok(await evaluate(`MerchUI.state.concepts.length > ${nBefore} && document.querySelectorAll('#mx-strip .mx-film__tag').length >= 2`), `${tag}: variations added to the filmstrip`);
  await click('#mx-strip .mx-film');
  // Inline print checks.
  ok(await evaluate("document.querySelectorAll('#mx-studio-checks li').length >= 1 && !document.querySelector('#mx-studio-checks .mx-check-row--error') && !document.getElementById('mx-to-setup').disabled"), `${tag}: print checks inline, Use this design on`);
  await audit(`${tag}-studio`);
  // ── Product step: live mockups requested automatically for admins.
  calls.length = 0; bodies.length = 0; stored.length = 0;
  blockPut = theme === 'dark'; // dark run: the direct upload is blocked, so the relay carries it
  await click('#mx-to-setup');
  await until("!document.getElementById('mx-view-setup').hidden && document.querySelectorAll('#mx-blanks [data-tpl]').length === 5 && document.getElementById('mx-price').value", `${tag} setup`);
  await until("document.querySelector('#mx-pstage-main .mx-pstage__live img') && document.querySelectorAll('#mx-mockups img').length === 6", `${tag} live mockups (auto)`, 15000);
  ok(calls.filter(c => c === 'upload-url').length === 2 && calls.includes('register') && calls.includes('preview'), `${tag}: print + logo uploaded, preview asked automatically (${calls.join(',')})`);
  ok(await evaluate("document.getElementById('mx-preview').hidden && /Fourthwall live mockups/.test(document.getElementById('mx-pstage-title').textContent)"), `${tag}: fresh live mockups, no update button`);
  if (blockPut) {
    const relays = bodies.filter(b => b.mode === 'upload-relay');
    ok(relays.length === 2, `${tag}: relay used for both files (${relays.length})`);
    ok(stored.length === 2 && stored.every(k => /^merch-art\/00000000-0000-0000-0000-000000000001\/[\w-]+\.png$/.test(k)), `${tag}: files went to merch-art/<user>/<file>.png (${stored.join(' ')})`);
    ok(relays.every(b => b.bucket === 'merch-art' && /^00000000-0000-0000-0000-000000000001\//.test(b.path) && /blocked\.example/.test(b.uploadUrl) && b.size > 0), `${tag}: relay gets path, uploadUrl and size`);
  }
  blockPut = false;
  ok(await evaluate("document.querySelector('#mx-blanks [aria-checked=true]').dataset.kind === 'tee' && MerchUI.state.colors.join() === 'Black'"), `${tag}: tee, in the studio's colour`);
  ok(calls.includes('copy') && await evaluate("/earn about/.test(document.getElementById('mx-earn').textContent)"), `${tag}: copy + earnings`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Left sleeve|Right sleeve|No logo' && document.getElementById('mx-logo').value === 'sleeve_left'"), `${tag}: logo areas`);
  ok(await evaluate("document.querySelectorAll('#mx-checks li').length >= 1 && !document.querySelector('#mx-checks .mx-check-row--error')"), `${tag}: product print check`);
  // Gallery.
  await click('#mx-pstage-main .mx-pstage__live');
  ok(await evaluate("document.getElementById('mx-gallery').open && /1 of 6/.test(document.getElementById('mx-gallery-cap').textContent)"), `${tag}: main mockup opens the gallery`);
  await click('#mx-gallery-close');
  // A colour change makes them out of date.
  await click('#mx-colors [data-color="French Navy"]');
  ok(await evaluate("MerchUI.state.colors.join() === 'French Navy' && !document.getElementById('mx-preview').hidden && /Update mockups/.test(document.getElementById('mx-preview').textContent) && /Out of date/.test(document.getElementById('mx-pstage-title').textContent)"), `${tag}: Update mockups after a colour change`);
  ok(await evaluate(`${sel()}.garment.name === 'French Navy'`), `${tag}: product colour follows back to the design`);
  calls.length = 0;
  await click('#mx-preview');
  await until("document.getElementById('mx-preview').hidden && !/Out of date/.test(document.getElementById('mx-pstage-title').textContent)", `${tag} mockups updated`, 15000);
  ok(calls.includes('preview') && bodies.filter(b => b.mode === 'preview').pop().color === 'French Navy', `${tag}: update asks for the new colour`);
  await audit(`${tag}-setup`);
  // ── Blanks: each kind has its own area, logo spot, price and checks.
  await click('#mx-blanks [data-kind="mug"]');
  await until("/Mug$/.test(document.getElementById('mx-title-input').value)", `${tag} mug copy`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Inside the design (small ES pill at the bottom)|No logo'"), `${tag}: mug logo goes under the design`);
  ok(await evaluate("document.getElementById('mx-colors-block').hidden"), `${tag}: one-colour blank hides the colour picker`);
  ok(await evaluate("Number(document.getElementById('mx-price').value) === 15.99 && /suggested \\$15\\.99/.test(document.getElementById('mx-earn').textContent)"), `${tag}: mug price + suggestion`);
  ok(await evaluate("/handle/.test(document.getElementById('mx-checks').textContent) && /300 DPI/.test(document.getElementById('mx-checks').textContent) && /2700 × 1050 px at 300 DPI/.test(document.getElementById('mx-checks').textContent)"), `${tag}: mug wrap + 300 DPI checks at the template size`);
  await until("/Mug preview, ES logo inside the design/.test(document.getElementById('mx-pstage-canvas').getAttribute('aria-label')) && !document.getElementById('mx-pstage-canvas').hidden", `${tag}: mug preview replaces the tee mockups`);
  await audit(`${tag}-setup-mug`);
  await click('#mx-blanks [data-kind="sticker"]');
  await until("/cut line/.test(document.getElementById('mx-checks').textContent)", `${tag} sticker cut check`);
  await click('#mx-blanks [data-kind="poster"]');
  await until("/trim/.test(document.getElementById('mx-checks').textContent)", `${tag} poster trim check`);
  await click('#mx-blanks [data-kind="hoodie"]');
  await until("/Hoodie$/.test(document.getElementById('mx-title-input').value) && document.getElementById('mx-colors-label').textContent === 'Hoodie colour'", `${tag} hoodie`);
  ok(await evaluate("[...document.getElementById('mx-logo').options].map(o => o.textContent).join('|') === 'Left sleeve|Back neck|No logo'"), `${tag}: hoodie logo areas`);
  await click('#mx-blanks [data-kind="tee"]');
  await until("/Tee$/.test(document.getElementById('mx-title-input').value) && document.getElementById('mx-logo').value === 'sleeve_left'", `${tag} back to tee`);
  // ── Shop collections in Setup.
  await until("document.querySelectorAll('[data-colls=setup] [data-coll-id]').length >= 3", `${tag} setup collections`);
  await click('[data-colls=setup] [data-coll-id="col_fan"]');
  await click('[data-colls=setup] [data-coll-act="new"]');
  await until("document.querySelector('[data-coll-name=setup]')", `${tag} new collection field`);
  const collName = `QA drop ${tag}`;
  await evaluate(`(() => { const i = document.querySelector('[data-coll-name=setup]'); i.value = ${JSON.stringify(collName)}; return true; })()`);
  await click('[data-colls=setup] [data-coll-act="add"]');
  await until(`[...document.querySelectorAll('[data-colls=setup] .mx-cchip')].some(l => l.textContent.includes(${JSON.stringify(collName)}) && l.querySelector('input').checked)`, `${tag} new collection ticked`);
  ok(await evaluate("MerchUI.state.pick.setup.length === 2"), `${tag}: two collections picked`);
  ok(await evaluate("document.getElementById('mx-to-live').disabled"), `${tag}: Continue waits for the rights tick`);
  await click('#mx-ack');
  ok(!(await evaluate("document.getElementById('mx-to-live').disabled")), `${tag}: tick enables Continue`);
  // Back to the studio and forward again keeps the choices.
  await click('#mx-back-studio');
  ok(await evaluate("!document.getElementById('mx-view-designs').hidden"), `${tag}: back to the studio`);
  await click('#mx-to-setup');
  await until("!document.getElementById('mx-view-setup').hidden && document.getElementById('mx-ack').checked", `${tag} setup again`);
  await click('#mx-to-live');
  await until("!document.getElementById('mx-view-live').hidden && /T-shirt/.test(document.getElementById('mx-push-status').textContent)", `${tag} live view`);
  await audit(`${tag}-push`);
  calls.length = 0;
  await click('#mx-create-fw');
  await until("!document.getElementById('mx-live').hidden && document.querySelector('#mx-live img')", `${tag} product`);
  ok(calls.includes('create'), `${tag}: create (${calls.join(',')})`);
  const createBody = bodies.filter(b => b.mode === 'create').pop();
  ok(createBody && !('designedStack' in createBody.concept) && createBody.content?.trend?.id === 't4', `${tag}: create sends the clean concept and the trend`);
  const setCall = bodies.filter(b => b.mode === 'collection-set').pop();
  ok(setCall && setCall.collectionIds.length === 2 && setCall.collectionIds.includes('col_fan'), `${tag}: create puts it in the picked collections`);
  ok(await evaluate("/Hidden/.test(document.querySelector('#mx-live .es-badge').textContent) && Boolean(document.querySelector('#mx-live [data-live=copy-desc]'))"), `${tag}: created hidden, copy description`);
  await audit(`${tag}-live`);
  await click('#mx-live [data-live="publish"]');
  await until("/Live/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} publish`);
  await click('#mx-live [data-live="hide"]');
  await until("/Hidden/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} hide`);
  ok(await evaluate("document.querySelector('[data-coll-act=save]').disabled"), `${tag}: save waits for a change`);
  await click('[data-colls=live] [data-coll-id="col_fan"]');
  await click('[data-coll-act="save"]');
  await until("/Saved/.test(document.querySelector('[data-coll-status=live]')?.textContent || '')", `${tag} live collections saved`);
  // ── Archive with a typed confirm.
  await click('#mx-live [data-live="archive"]');
  await until("document.getElementById('mx-archive').open", `${tag} archive dialog`);
  ok(await evaluate("document.getElementById('mx-archive-go').disabled && document.activeElement.id === 'mx-archive-input'"), `${tag}: archive waits for the name`);
  await evaluate("(() => { const i = document.getElementById('mx-archive-input'); i.value = '  ' + MerchUI.state.product.name.toLowerCase() + ' '; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(!(await evaluate("document.getElementById('mx-archive-go').disabled")), `${tag}: the typed name enables Archive`);
  await audit(`${tag}-archive-dialog`);
  await click('#mx-archive-go');
  await until("!document.getElementById('mx-archive').open && /Archived/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} archived`);
  // ── Your merch.
  calls.length = 0;
  await click('#mx-tab-list');
  await until("!document.getElementById('mx-view-list').hidden && document.querySelectorAll('#mx-list tbody tr').length >= 5", `${tag} list`);
  ok(calls.includes('list') && calls.includes('sales'), `${tag}: list + sales called`);
  ok(await evaluate("document.getElementById('mx-steps-nav').hidden && document.getElementById('mx-mode-box').hidden && document.getElementById('mx-tab-list').getAttribute('aria-selected') === 'true'"), `${tag}: list tab selected, steps and mode hidden`);
  ok(await evaluate("(() => { const r = document.querySelector('#mx-list tr[data-pid=prod_s1]'); return r && /Live/.test(r.textContent) && /364\\.00/.test(r.textContent) && r.querySelector('img') && r.querySelector('a[href*=ball-dont-lie]'); })()"), `${tag}: row has status, revenue, mockup and link`);
  ok(await evaluate("document.querySelectorAll('#mx-list-totals .mx-total').length === 4"), `${tag}: totals`);
  await audit(`${tag}-list`);
  await click('#mx-list tr[data-pid=prod_s2] [data-row=refresh]');
  await until("/up to date/.test(document.getElementById('mx-list-updated').textContent)", `${tag} row refresh`);
  await click('#mx-list tr[data-pid=prod_s2] [data-row=mockups]');
  await until("document.querySelectorAll('#mx-list .mx-lt__more img').length > 0", `${tag} row mockups`);
  await click('#mx-tab-make');
  ok(await evaluate("!document.getElementById('mx-view-live').hidden"), `${tag}: Create tab returns to the last step`);
  // The mode is remembered on the next visit.
  if (pro) {
    await send('Page.reload');
    await until("window.MerchUI && MerchUI.state.aiMode === 'pro' && document.querySelector('#mx-mode [data-ai=pro]').getAttribute('aria-checked') === 'true'", `${tag} Pro remembered after reload`);
  }
}

// ─── Page states ──────────────────────────────────────────────────────────
async function quickDesigns(tag, text = 'Ball don’t lie') {
  await setText('#mx-text', text);
  await click('#mx-create');
  await until("document.querySelectorAll('#mx-strip .mx-film').length > 0 && !document.getElementById('mx-view-designs').hidden", `${tag} designs`);
}
async function states(width, theme) {
  const tag = `${width}-${theme}`;
  scenario = 'not-set-up';
  await load(width, theme, 'nsu');
  await until("/FOURTHWALL_API_USERNAME/.test(document.getElementById('mx-banner').textContent)", `${tag} not-set-up banner`);
  await audit(`${tag}-not-set-up`);

  scenario = 'free';
  await load(width, theme, 'free');
  await quickDesigns(`${tag} free`, 'We center fans');
  await until("/Free mode/.test(document.getElementById('mx-banner').textContent)", `${tag} free banner`);
  ok(await evaluate("/without AI/.test(document.getElementById('mx-designs-sub').textContent) && document.getElementById('mx-made-mode').textContent === 'Made without AI' && document.getElementById('mx-idea').hidden"), `${tag}: free-mode note, no plan`);
  await click('#mx-chat-chips [data-say="Add the nickname"]');
  await until("/Free mode can do/.test(document.getElementById('mx-chat-note').textContent)", `${tag} free refine explains what it can do`);
  await click('#mx-chat-chips [data-say="Centre it"]');
  await until(`${sel()}.align === 'center'`, `${tag} free refine runs simple intents`);
  await audit(`${tag}-free-studio`);

  scenario = 'pro-cap';
  await load(width, theme, 'procap', 'pro');
  await quickDesigns(`${tag} pro-cap`);
  ok(await evaluate("!document.getElementById('mx-fell').hidden && /weekly AI limit/.test(document.getElementById('mx-fell').textContent) && document.getElementById('mx-banner').hidden && document.getElementById('mx-made-mode').textContent === 'Made without AI'"), `${tag}: Pro fallback note (${await evaluate("document.getElementById('mx-fell').textContent")})`);
  await audit(`${tag}-pro-cap`);

  scenario = 'no-moments';
  await load(width, theme, 'nomo');
  await until("document.querySelector('#mx-moments .es-empty')", `${tag} no moments empty state`);

  scenario = 'cant-push';
  await load(width, theme, 'cp');
  await until("MerchUI.state.status", `${tag} cant-push status`);
  await quickDesigns(`${tag} cp`);
  calls.length = 0;
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cp setup`);
  ok(!calls.includes('preview') && !calls.includes('upload-url') && await evaluate("document.getElementById('mx-preview').hidden && !document.getElementById('mx-pstage-canvas').hidden && /blank photo/.test(document.getElementById('mx-pstage-title').textContent)"), `${tag}: non-admins see FrameUp's preview, no Fourthwall calls`);
  await click('#mx-ack');
  await click('#mx-to-live');
  await until("/Ask an admin to publish this/.test(document.getElementById('mx-push-status').textContent)", `${tag} can't-push message`);
  ok(await evaluate("document.getElementById('mx-create-fw').disabled"), `${tag}: create disabled for non-pushers`);
  await audit(`${tag}-cant-push`);

  scenario = 'cap';
  await load(width, theme, 'cap');
  await until("MerchUI.state.status", `${tag} cap status`);
  await quickDesigns(`${tag} cap`);
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cap setup`);
  await click('#mx-ack');
  await click('#mx-to-live');
  await click('#mx-create-fw');
  await until("/daily limit/.test(document.getElementById('mx-push-status').textContent)", `${tag} daily cap message`);

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
  await until("document.querySelector('#mx-moments .es-error-state [data-moments=retry]')", `${tag} moments error with retry`);
  await audit(`${tag}-content-error`);
  await click('#mx-tab-list');
  await until("document.querySelector('#mx-list .es-error-state [data-list-act=retry]')", `${tag} list error with retry`);
  await click('#mx-tab-make');
  await quickDesigns(`${tag} error → fallback designs`);
  ok(await evaluate("/didn’t load/.test(document.getElementById('mx-tee-colors-note').textContent) && document.querySelectorAll('#mx-tee-colors [role=radio]').length >= 2"), `${tag}: studio falls back to drawn colours when templates fail`);
  await click('#mx-to-setup');
  await until("document.querySelector('#mx-blanks-retry')", `${tag} templates error with retry`);
  await audit(`${tag}-error`);
}

try {
  await flow(1440, 'light', 'pro');
  await flow(1440, 'dark', 'pro');
  await flow(1024, 'light', 'basic');
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
console.log(`merch ui: ${checks} checks passed (1440 light + dark Pro, 1024 light Basic; moments, studio, refine + undo, extras, live mockups, blanks, collections, archive, list, relay and states)`);
