// Merch Designs UI check (Merch5): drives merch.html in real headless Chrome
// through Create → Design → Publish (+ Your merch) against a mocked /api/merch
// (the replies in merch-demo.js), then the page-level states.
// Desktop: 1440 light (Pro), 1440 dark (Pro, upload relay), 1024 light (Basic);
// plus the list view at 375 (no horizontal scroll on a phone).
// Covers: one bar (3 steps, back to done steps only, "Your merch" + count);
// Create (hero, prompt card, Basic/Pro hint, ES story link toggle, Style
// select, moment chip from a moment tile, rules disclosure); Design (making
// checklist + skeleton filmstrip + Stop, empty stage, filmstrip arrows, stage
// view toggle, undo/redo, fold defaults + memory, print badge → Checks fold,
// tee colour only in Design, team swatch, custom hex + contrast warning,
// per-pill popover, Extras locked in Basic, Try other layouts, Ask AI refine,
// one sticky primary); Publish (one preview, read-only colour line + Change,
// blanks, listing, collections, rights tick, blocker line, progress steps, the
// live panel replacing the form, archive); Your merch; and the states (not set
// up, free, Pro cap, no moments, can't push, daily cap, list from Fourthwall,
// empty list, errors). Fails on: horizontal scroll, more than one primary
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
let slow = 0; // ms delay on 'concepts' so the making state can be seen
const { server, base } = await startServer({
  api: (req, url, body) => {
    if (url.pathname === '/api/merch') {
      calls.push(body?.mode);
      bodies.push(body || {});
      const [status, data] = DEMO.reply(body || {}, scenario);
      if (body?.mode === 'upload-url' && blockPut) data.uploadUrl = 'https://upload.blocked.example/put';
      return { status, body: data, delay: body?.mode === 'concepts' ? slow : 0 };
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
  // /api/merch 4xx / 5xx are the error states under test.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.g|favicon|\/api\/merch|blocked\.example/.test(m.params.entry.url || '')) errors.push('log: ' + m.params.entry.text.slice(0, 160) + ' ' + (m.params.entry.url || ''));
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
const ev = expr => evaluate(expr);
const click = s => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return false; e.click(); return true; })()`);
const key = (k, o = {}) => ev(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, metaKey: ${!!o.meta}, ctrlKey: ${!!o.ctrl}, shiftKey: ${!!o.shift} })); return true; })()`);
const setText = (s, v, type = 'input') => ev(`(() => { const t = document.querySelector(${JSON.stringify(s)}); t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); return true; })()`);
const visible = s => `(() => { const e = document.querySelector(${JSON.stringify(s)}); return Boolean(e && e.checkVisibility({ checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0); })()`;
const sel = () => 'MerchUI.state.concepts.find(c => c.id === MerchUI.state.selected)';
const step = s => `MerchUI.state.step === ${JSON.stringify(s)}`;

async function load(width, theme, state = '', mode = '') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/__blank` });
  await sleep(200);
  await ev(FAKE_SESSION);
  await ev(`(() => { ${mode ? `localStorage.setItem('frameup.merch.aiMode', ${JSON.stringify(mode)})` : "localStorage.removeItem('frameup.merch.aiMode')"}; localStorage.removeItem('mx.folds'); return true; })()`);
  await ev("sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); true");
  await send('Page.navigate', { url: `${base}/merch.html?demo=off${state ? `&x=${state}` : ''}` });
  await until("window.MerchUI && MerchUI.state && document.querySelectorAll('#mx-collection option').length === 6 && document.documentElement.style.visibility !== 'hidden'", 'page ready', 15000);
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(s); window.FrameUpTheme?.apply ? window.FrameUpTheme.apply(${JSON.stringify(theme)}) : (document.documentElement.dataset.theme = ${JSON.stringify(theme)}); return true; })()`);
  await sleep(300);
}

const AUDIT = `(() => {
  const out = [];
  const vis = e => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0;
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push("horizontal scroll " + document.documentElement.scrollWidth + " " + [...document.querySelectorAll("#main *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => e.tagName + "." + String(e.className).slice(0, 30)).join(" | "));
  const main = document.getElementById('main');
  const prim = [...main.querySelectorAll('.es-btn--primary')].filter(vis);
  if (prim.length > 1) out.push('primary buttons: ' + prim.length + ' ' + prim.map(p => p.id || p.textContent.trim().slice(0, 20)).join(', '));
  main.querySelectorAll('button,a[href],input,select,textarea,[role=radio]').forEach(e => {
    if (!vis(e) || e.closest('[aria-hidden=true]')) return;
    const name = (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ') || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || (['INPUT','SELECT','TEXTAREA'].includes(e.tagName) ? '' : e.textContent) || e.title || '').trim();
    if (!name) out.push('no name: ' + e.tagName + '#' + e.id + '.' + e.className);
  });
  main.querySelectorAll('img').forEach(i => { if (vis(i) && i.complete && i.naturalWidth === 0) out.push('broken image ' + i.src.slice(-40)); });
  main.querySelectorAll('h1,h2,h3,p,span,label,button').forEach(e => { if (vis(e) && !e.closest('.es-sr-only') && getComputedStyle(e).overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') out.push('clipped: ' + e.textContent.trim().slice(0, 30)); });
  const fam = getComputedStyle(main).fontFamily.split(',')[0].replace(/["']/g, '');
  if (!/roboto|acumin/i.test(fam)) out.push('font ' + fam);
  return out;
})()`;
async function audit(tag) {
  const found = await ev(AUDIT);
  found.forEach(f => fails.push(`${tag}: ${f}`));
  checks += 1;
  if (SHOTS) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, `merch-${tag}.png`), Buffer.from(r.result.data, 'base64'));
  }
}
// The tee colour picker lives only in Design.
const TEE_ONLY_IN_DESIGN = "(() => { const t = document.getElementById('mx-tee-colors'); return Boolean(t && t.closest('#mx-view-designs')) && !document.querySelector('#mx-view-publish #mx-tee-colors, #mx-view-publish [data-hex]'); })()";

// ─── Full flow ────────────────────────────────────────────────────────────
async function flow(width, theme, mode) {
  const tag = `${width}-${theme}-${mode}`;
  const pro = mode === 'pro';
  scenario = 'ok';
  calls.length = 0;
  bodies.length = 0;
  await load(width, theme);
  await until("/connected/i.test(document.getElementById('mx-conn').textContent)", `${tag} status`);

  // ── Bar: 3 steps, forward locked, Your merch.
  ok(await ev("[...document.querySelectorAll('#mx-steps [data-step]')].map(b => b.dataset.step).join() === 'content,designs,publish'"), `${tag}: three steps`);
  ok(await ev("document.querySelector('#mx-steps [data-step=content]').getAttribute('aria-current') === 'step' && document.querySelector('#mx-steps [data-step=designs]').disabled && document.querySelector('#mx-steps [data-step=publish]').disabled"), `${tag}: Create is current, later steps locked`);
  ok(await ev("!document.querySelector('#main [role=tablist]') && !document.querySelector('.mx-bar #mx-mode')"), `${tag}: no tabs, no Basic/Pro in the bar`);
  ok(await ev(TEE_ONLY_IN_DESIGN), `${tag}: tee colour only in Design`);

  // ── Create.
  ok(await ev("/Make fan merch with/.test(document.getElementById('mx-h-content').textContent) && Boolean(document.querySelector('#mx-h-content .ais-gradient-text'))"), `${tag}: hero with the gradient AI word`);
  ok(await ev("document.getElementById('mx-create').disabled"), `${tag}: Create designs starts disabled`);
  ok(await ev("document.querySelector('#mx-mode [data-mode=basic]').matches('[aria-checked=true],[aria-pressed=true]') && MerchUI.state.aiMode === 'basic' && /4 designs/.test(document.getElementById('mx-mode-hint').textContent)"), `${tag}: Basic by default with its hint`);
  if (pro) {
    await click('#mx-mode [data-mode=pro]');
    ok(await ev("MerchUI.state.aiMode === 'pro' && localStorage.getItem('frameup.merch.aiMode') === 'pro' && /6 designs/.test(document.getElementById('mx-mode-hint').textContent)"), `${tag}: Pro picked, hint and remembered`);
  }
  await click('#mx-url-toggle');
  ok(await ev("document.getElementById('mx-url-toggle').getAttribute('aria-expanded') === 'true'") && await ev(visible('#mx-url')), `${tag}: + ES story link reveals the link field`);
  ok(await ev("!document.getElementById('mx-rules').hidden && document.querySelectorAll('#mx-rules-list li').length >= 3"), `${tag}: How the AI designs lists the ES rules`);
  await until("document.querySelectorAll('#mx-moments [data-moment-use]').length >= 3", `${tag} moments`);
  ok(calls.includes('moments'), `${tag}: moments called`);
  ok(await ev("getComputedStyle(document.getElementById('mx-moments')).gridTemplateColumns.split(' ').length === 3"), `${tag}: moments in 3 columns`);
  if (await ev("document.querySelectorAll('#mx-moments-sports [data-sport]').length > 2")) {
    await click('#mx-moments-sports [data-sport="NFL"]');
    ok(await ev("document.querySelectorAll('#mx-moments [data-moment-use]').length === 1"), `${tag}: sport filter`);
    await click('#mx-moments-sports [data-sport=""]');
  }
  await audit(`${tag}-create-empty`);
  await click('#mx-moments [data-moment-use]');
  ok(await ev("!document.getElementById('mx-moment-chip').hidden && /^\\s*Moment: /.test(document.getElementById('mx-moment-chip').textContent) && document.getElementById('mx-text').value.length > 1"), `${tag}: Use this fills the brief and shows the moment chip`);
  await click('#mx-moment-chip [data-chip-clear]');
  ok(await ev("document.getElementById('mx-moment-chip').hidden"), `${tag}: the chip × removes the moment`);
  await setText('#mx-text', 'Ball don’t lie');
  await click('#mx-moments [data-moment-use]');
  ok(await ev("document.getElementById('mx-text').value === 'Ball don’t lie' && !document.getElementById('mx-moment-chip').hidden"), `${tag}: a typed line is kept when a moment is used`);
  ok(!(await ev("document.getElementById('mx-create').disabled")), `${tag}: Create designs enabled`);
  await audit(`${tag}-create`);

  // ── Making: checklist + skeletons + Stop.
  slow = 1500;
  await click('#mx-create');
  await until(`${step('designs')} && MerchUI.state.making && !document.getElementById('mx-making').hidden`, `${tag} making`);
  ok(await ev(`document.querySelectorAll('#mx-making li').length === ${pro ? 5 : 4} && document.querySelectorAll('#mx-making li[data-pro]').length === ${pro ? 1 : 0}`), `${tag}: making checklist (${pro ? 'Pro plans the idea' : 'Basic, 4 steps'})`);
  ok(await ev(visible('#mx-making')) && await ev(visible('#mx-stop')), `${tag}: checklist and Stop visible on the stage`);
  ok(await ev(`document.querySelectorAll('#mx-strip .mx-film__skel').length === ${pro ? 6 : 4}`), `${tag}: skeleton filmstrip`);
  ok(await ev("document.getElementById('mx-to-setup').disabled && document.querySelector('#mx-steps [data-step=publish]').disabled"), `${tag}: Publish locked while making`);
  await audit(`${tag}-making`);
  await until('!MerchUI.state.making && MerchUI.state.concepts.length > 0', `${tag} designs arrive`, 15000);
  slow = 0;
  const cBody = bodies.filter(b => b.mode === 'concepts').pop();
  ok(cBody && cBody.designMode === mode && cBody.content?.text === 'Ball don’t lie' && cBody.trend, `${tag}: concepts gets designMode, trend and content (${JSON.stringify(cBody).slice(0, 160)})`);
  ok(await ev(`MerchUI.state.concepts.length === ${pro ? 6 : 4} && document.querySelectorAll('#mx-strip [data-pick]').length === MerchUI.state.concepts.length`), `${tag}: filmstrip has every design`);
  ok(await ev("MerchUI.state.selected === MerchUI.state.concepts[0].id && document.getElementById('mx-making').hidden && document.getElementById('mx-empty-stage').hidden && !document.getElementById('mx-stage-canvas').hidden"), `${tag}: first design on the stage`);
  ok(await ev(visible('#mx-strip-new')), `${tag}: New set tile`);
  await until("/Rights:/.test(document.getElementById('mx-stage-cap').textContent)", `${tag} stage caption with rights`);
  if (pro) ok(await ev("!document.getElementById('mx-idea').hidden"), `${tag}: the idea line (Pro)`);

  // ── Fold defaults and memory.
  ok(await ev("document.getElementById('mx-fold-text').open && document.getElementById('mx-fold-colors').open && !document.getElementById('mx-fold-layout').open && !document.getElementById('mx-fold-extras').open"), `${tag}: fold defaults (Text, Colours open; Layout, Extras closed)`);
  ok(await ev("['text','colors','layout','extras','checks'].every(f => document.getElementById('mx-fold-' + f + '-meta')) && /pill/.test(document.getElementById('mx-fold-text-meta').textContent)"), `${tag}: every fold shows its meta`);
  await ev("document.getElementById('mx-fold-layout').open = true; true");
  await sleep(150);
  ok(await ev("(() => { try { return JSON.parse(localStorage.getItem('mx.folds')).layout === true; } catch { return false; } })()"), `${tag}: fold state remembered`);

  // ── Stage: badge → Checks fold, view toggle, filmstrip keys.
  ok(await ev("/^(Print-ready|\\d+ to fix)$/.test(document.getElementById('mx-stage-badge').textContent.trim())"), `${tag}: print badge`);
  await ev("document.getElementById('mx-fold-checks').open = false; true");
  await click('#mx-stage-badge');
  ok(await ev("document.getElementById('mx-fold-checks').open && document.querySelectorAll('#mx-studio-checks li').length >= 1"), `${tag}: the badge opens Print checks`);
  await click('#mx-view-toggle [data-view=closeup]');
  ok(await ev("MerchUI.state.view === 'closeup'"), `${tag}: Close-up`);
  await click('#mx-view-toggle [data-view=tee]');
  ok(await ev("MerchUI.state.view === 'tee' && /On a tee/.test(document.querySelector('#mx-view-toggle [data-view=tee]').textContent)"), `${tag}: On a tee`);
  await ev('document.activeElement?.blur(); true');
  const first = await ev('MerchUI.state.selected');
  await key('ArrowRight');
  ok(await ev(`MerchUI.state.selected !== ${JSON.stringify(first)}`), `${tag}: → moves through the filmstrip`);
  await key('ArrowLeft');
  ok(await ev(`MerchUI.state.selected === ${JSON.stringify(first)}`), `${tag}: ← moves back`);
  await ev('document.activeElement?.blur(); true');
  await key('/');
  ok(await ev("document.activeElement.id === 'mx-chat-input'"), `${tag}: / focuses Ask AI`);
  // FrameUp's own "/" (search palette) must not win over Ask AI; close it if it opened.
  if (!(await ev("document.activeElement.id === 'mx-chat-input'"))) { await ev("document.querySelectorAll('dialog[open]').forEach(d => d.close()); true"); await sleep(100); }
  await ev('document.activeElement?.blur(); true');

  // ── Tee colour (Design only) and pill colours.
  await until("document.querySelectorAll('#mx-tee-colors [role=radio]').length >= 2", `${tag} tee colours`);
  await click('#mx-tee-colors [data-name="Black"]');
  ok(await ev(`${sel()}.garment.name === 'Black'`), `${tag}: tee colour picks`);
  await until("document.querySelectorAll('#mx-pal-sport option').length > 3", `${tag} sport options`);
  await ev("(() => { const s = document.getElementById('mx-pal-sport'); const o = [...s.options].find(x => /NBA/.test(x.textContent)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()");
  await until("document.querySelectorAll('#mx-pal-team option').length > 5", `${tag} team options`);
  await ev("(() => { const s = document.getElementById('mx-pal-team'); const o = [...s.options].find(x => /Lakers/.test(x.textContent)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()");
  await until("document.querySelectorAll('#mx-pal-swatches [role=radio]').length >= 2", `${tag} team swatches`);
  ok(await ev("/Aa/.test(document.getElementById('mx-pal-swatches').textContent) && document.getElementById('mx-pal-swatches').getAttribute('role') === 'radiogroup'"), `${tag}: team swatches show Aa`);
  await click('#mx-pal-swatches [role=radio]:nth-child(2)');
  ok(await ev(`${sel()}.paletteFrom && ${sel()}.paletteFrom.kind === 'team'`), `${tag}: team swatch sets the palette`);
  ok(await ev("document.querySelectorAll('#mx-pal-es [role=radio]').length === 4"), `${tag}: four ES colours`);
  await setText('#mx-pal-hex', '#0B0B0B', 'change');
  ok(await ev(`${sel()}.paletteFrom.kind === 'custom' && /^#0B0B0B$/i.test(${sel()}.palette.a)`), `${tag}: custom hex sets the palette`);
  ok(await ev("!document.getElementById('mx-pal-warn').hidden && /Low contrast on a Black tee/.test(document.getElementById('mx-pal-warn').textContent)"), `${tag}: contrast warning on a dark custom colour`);
  await audit(`${tag}-design-warn`);
  await click('#mx-pal-es [role=radio]');
  ok(await ev(`${sel()}.paletteFrom.kind === 'es'`), `${tag}: ES Blue sets the palette`);

  // ── Per-pill popover.
  await click('#mx-pills [data-pill-color="0"]');
  ok(await ev("!document.getElementById('mx-pill-pop').hidden && document.querySelector('[data-pill-color=\"0\"]').getAttribute('aria-expanded') === 'true'"), `${tag}: the colour dot opens the pill popover`);
  await audit(`${tag}-design-pop`);
  await ev("(() => { const h = document.querySelector('#mx-pill-pop [data-pal=hex]'); h.value = '#FFD700'; h.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  ok(await ev(`/^#FFD700$/i.test(${sel()}.stack[0].fill)`), `${tag}: per-pill custom colour`);
  await click('#mx-pill-pop [data-pill-reset]');
  ok(await ev(`['a','b'].includes(${sel()}.stack[0].fill) && document.getElementById('mx-pill-pop').hidden`), `${tag}: Use design colours resets the pill`);

  // ── Pills, undo / redo.
  await setText('#mx-pills [data-pill-text="0"]', 'KOBE!');
  ok(await ev(`${sel()}.stack[0].text === 'KOBE!'`), `${tag}: pill text edits`);
  const nPills = await ev(`${sel()}.stack.length`);
  await click('#mx-pill-add');
  ok(await ev(`${sel()}.stack.length === ${nPills + 1}`), `${tag}: add a pill`);
  await click('#mx-undo');
  ok(await ev(`${sel()}.stack.length === ${nPills}`), `${tag}: undo`);
  ok(!(await ev("document.getElementById('mx-redo').disabled")), `${tag}: redo enabled after undo`);
  await click('#mx-redo');
  ok(await ev(`${sel()}.stack.length === ${nPills + 1}`), `${tag}: redo`);
  await click('#mx-undo');

  // ── Layout & size, Extras.
  await ev("(() => { const r = document.getElementById('mx-fit-scale'); r.value = 130; r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  ok(await ev(`${sel()}.fit.scale === 1.3 && document.getElementById('mx-fit-scale-out').textContent === '130%'`), `${tag}: size slider`);
  await click('#mx-fit-reset');
  ok(await ev(`${sel()}.fit.scale === 1`), `${tag}: reset layout`);
  const nBefore = await ev('MerchUI.state.concepts.length');
  await click('#mx-vary');
  ok(await ev(`MerchUI.state.concepts.length > ${nBefore} && MerchUI.state.concepts.some(c => c.variantOf)`), `${tag}: Try other layouts adds variations`);
  if (pro) ok(await ev("document.getElementById('mx-extras-locked').hidden"), `${tag}: Pro extras unlocked`);
  else ok(await ev("!document.getElementById('mx-extras-locked').hidden && !document.getElementById('mx-go-pro').hidden"), `${tag}: Basic: Extras locked with Switch to Pro`);

  // ── Ask AI refine.
  await click('#mx-strip [data-pick]');
  await click('#mx-chat-chips [data-say="Centre it"]');
  await until(`${sel()}.align === 'center' && document.getElementById('mx-chat-note').textContent.length > 3`, `${tag} refine centre`);
  await until('!MerchUI.state.refining', `${tag} refine settled`);
  await setText('#mx-chat-input', 'use Lakers colours please');
  await click('#mx-chat-send');
  for (let t = 0; t < 60 && !bodies.some(b => b.mode === 'refine' && b.instruction === 'use Lakers colours please'); t++) await sleep(100);
  await until("!MerchUI.state.refining && document.getElementById('mx-chat-note').textContent.length > 3", `${tag} refine typed`);
  const rBody = bodies.filter(b => b.mode === 'refine').pop();
  ok(rBody && rBody.designMode === mode && rBody.instruction === 'use Lakers colours please', `${tag}: refine sends the instruction and mode (${rBody?.instruction} / ${rBody?.designMode})`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} continue enabled`);
  ok(await ev("document.querySelector('#mx-studio-checks .mx-check-row--error') ? !document.getElementById('mx-design-blocker').hidden : document.getElementById('mx-design-blocker').hidden"), `${tag}: blocker line matches the checks`);
  await audit(`${tag}-design`);

  // ── Publish.
  calls.length = 0; bodies.length = 0; stored.length = 0;
  blockPut = theme === 'dark';
  await click('#mx-to-setup');
  await until(`${step('publish')} && document.querySelectorAll('#mx-blanks [data-tpl]').length === 5 && document.getElementById('mx-price').value`, `${tag} publish`);
  ok(await ev("!document.querySelector('#mx-steps [data-step=designs]').disabled && !document.querySelector('#mx-steps [data-step=content]').disabled"), `${tag}: done steps stay open`);
  ok(await ev(TEE_ONLY_IN_DESIGN) && await ev("/Black tee/i.test(document.getElementById('mx-pub-color').textContent)") && await ev(visible('#mx-pub-color-change')), `${tag}: read-only colour line with Change`);
  ok(await ev("document.querySelectorAll('#mx-view-publish canvas:not([hidden])').length <= 1"), `${tag}: one preview`);
  await until("document.querySelector('#mx-pstage .mx-pstage__live img') && document.querySelectorAll('#mx-mockups img').length >= 2", `${tag} live mockups (auto)`, 15000);
  ok(calls.filter(c => c === 'upload-url').length >= 1 && calls.includes('preview'), `${tag}: preview asked automatically (${calls.join(',')})`);
  if (blockPut) ok(bodies.some(b => b.mode === 'upload-relay') && stored.every(k => /^merch-art\//.test(k)), `${tag}: upload relay carries a blocked upload`);
  blockPut = false;
  await until("/earn/.test(document.getElementById('mx-earn').textContent)", `${tag} earnings`);
  ok(await ev("document.getElementById('mx-create-fw').disabled && !document.getElementById('mx-pub-blocker').hidden && /rights/i.test(document.getElementById('mx-pub-blocker').textContent)"), `${tag}: Create waits for the rights tick, one blocker line`);
  ok(await ev("/Created hidden/.test(document.getElementById('mx-view-publish').textContent)"), `${tag}: created hidden note`);
  await audit(`${tag}-publish`);
  await click('#mx-pub-color-change');
  ok(await ev(`${step('designs')} && document.getElementById('mx-fold-colors').open`), `${tag}: Change jumps to the Colours fold`);
  await click('#mx-to-setup');
  await until(`${step('publish')} && document.getElementById('mx-price').value`, `${tag} back on publish`);
  await until("document.querySelectorAll('[data-colls=setup] [data-coll-id]').length >= 3", `${tag} collections`);
  await click('[data-colls=setup] [data-coll-id="col_fan"]');
  await click('#mx-ack');
  await until("!document.getElementById('mx-create-fw').disabled && document.getElementById('mx-pub-blocker').hidden", `${tag} create enabled after the tick`);
  calls.length = 0;
  await click('#mx-create-fw');
  await until("!document.getElementById('mx-progress').hidden || !document.getElementById('mx-live').hidden", `${tag} progress`, 6000);
  ok(await ev("document.querySelectorAll('#mx-progress [data-prog]').length >= 3 || !document.getElementById('mx-live').hidden"), `${tag}: labelled progress steps`);
  await until("!document.getElementById('mx-live').hidden && document.querySelector('#mx-live img')", `${tag} live panel`, 20000);
  ok(calls.includes('create'), `${tag}: create (${calls.join(',')})`);
  ok(await ev("document.getElementById('mx-pub-form').hidden && Boolean(document.querySelector('#mx-live [data-go=content]'))"), `${tag}: the live panel replaces the form`);
  ok(await ev("/Hidden/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')"), `${tag}: created hidden`);
  await audit(`${tag}-live`);
  await click('#mx-live [data-live="publish"]');
  await until("/Live/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} publish to shop`);
  await click('#mx-live [data-live="hide"]');
  await until("/Hidden/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} hide`);
  await click('#mx-live [data-live="archive"]');
  await until("document.getElementById('mx-archive').open", `${tag} archive dialog`);
  ok(await ev("document.getElementById('mx-archive-go').disabled"), `${tag}: archive waits for the name`);
  await ev("(() => { const i = document.getElementById('mx-archive-input'); i.value = MerchUI.state.product.name; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('#mx-archive-go');
  await until("!document.getElementById('mx-archive').open && /Archived/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} archived`);

  // ── Your merch.
  calls.length = 0;
  await click('#mx-tab-list');
  await until(`${step('list')} && !document.getElementById('mx-view-list').hidden && document.querySelectorAll('#mx-list tbody tr').length >= 3`, `${tag} list`);
  ok(calls.includes('list'), `${tag}: list called`);
  ok(await ev("!document.getElementById('mx-list-count').hidden && Number(document.getElementById('mx-list-count').textContent) >= 1"), `${tag}: Your merch count`);
  ok(await ev("document.querySelectorAll('#mx-list-totals .mx-total').length === 4"), `${tag}: totals`);
  await audit(`${tag}-list`);
  await click('#mx-view-list [data-go=content]');
  ok(await ev(step('content')), `${tag}: Back to create`);
  if (pro) {
    await send('Page.reload');
    await until("window.MerchUI && MerchUI.state.aiMode === 'pro'", `${tag} Pro remembered after reload`);
  }
}

// ─── Page states ──────────────────────────────────────────────────────────
async function quickDesigns(tag, text = 'Ball don’t lie') {
  await setText('#mx-text', text);
  await click('#mx-create');
  await until(`!MerchUI.state.making && MerchUI.state.concepts.length > 0 && ${step('designs')}`, `${tag} designs`, 15000);
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
  ok(await ev("document.getElementById('mx-idea').hidden"), `${tag}: free mode, no idea line`);
  await click('#mx-chat-chips [data-say="Centre it"]');
  await until(`${sel()}.align === 'center'`, `${tag} free refine runs simple intents`);
  await audit(`${tag}-free`);

  scenario = 'pro-cap';
  await load(width, theme, 'procap', 'pro');
  await quickDesigns(`${tag} pro-cap`);
  ok(await ev("!document.getElementById('mx-fell').hidden && document.getElementById('mx-fell').textContent.length > 10"), `${tag}: Pro fallback note (${await ev("document.getElementById('mx-fell').textContent")})`);
  await audit(`${tag}-pro-cap`);

  scenario = 'no-moments';
  await load(width, theme, 'nomo');
  await until("document.querySelector('#mx-moments .es-empty')", `${tag} no moments empty state`);
  ok(await ev("/Refresh, or write your own line/.test(document.getElementById('mx-moments').textContent)"), `${tag}: no-moments copy`);

  scenario = 'cant-push';
  await load(width, theme, 'cp');
  await until('MerchUI.state.status', `${tag} cant-push status`);
  await quickDesigns(`${tag} cp`);
  calls.length = 0;
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} cp continue`);
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cp publish`);
  await click('#mx-ack');
  ok(!calls.includes('preview') && !calls.includes('upload-url'), `${tag}: non-admins: no Fourthwall calls`);
  await until("/Ask an admin to publish this/.test(document.getElementById('mx-view-publish').textContent)", `${tag} can't-push message`);
  ok(await ev("document.getElementById('mx-create-fw').disabled"), `${tag}: create disabled for non-pushers`);
  await audit(`${tag}-cant-push`);

  scenario = 'cap';
  await load(width, theme, 'cap');
  await until('MerchUI.state.status', `${tag} cap status`);
  await quickDesigns(`${tag} cap`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} cap continue`);
  await click('#mx-to-setup');
  await until("document.getElementById('mx-price').value", `${tag} cap publish`);
  await click('#mx-ack');
  await until("!document.getElementById('mx-create-fw').disabled", `${tag} cap create enabled`);
  await click('#mx-create-fw');
  await until("/daily limit/.test(document.getElementById('mx-view-publish').textContent)", `${tag} daily cap message`);
  ok(await ev("!document.getElementById('mx-pub-form').hidden"), `${tag}: the form stays after a failed create`);

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
  ok(await ev(step('content')), `${tag}: empty list sends you to create`);

  scenario = 'error';
  await load(width, theme, 'err');
  await until("document.querySelector('#mx-moments .es-error-state [data-moments=retry]')", `${tag} moments error with retry`);
  await audit(`${tag}-create-error`);
  await click('#mx-tab-list');
  await until("document.querySelector('#mx-list .es-error-state [data-list-act=retry]')", `${tag} list error with retry`);
  await click('#mx-view-list [data-go=content]');
  await quickDesigns(`${tag} error → fallback designs`);
  ok(await ev("document.querySelectorAll('#mx-tee-colors [role=radio]').length >= 2"), `${tag}: studio falls back to drawn colours when templates fail`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} err continue`);
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
console.log(`merch ui: ${checks} checks passed (1440 light + dark Pro, 1024 light Basic; Create, making, studio folds, pill colours, popover, Publish, live panel, list and states; 375 list)`);
