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
// Brainstorm room: open from a moment card (full width, Create + Brainstorm
// crumb, context sources), ask + angle chip turns (thinking row, skeletons,
// mode per turn), star, mix 2, add / edit own line, teammates' lines on the
// 20 s refresh (brainstorm-get), filters, Design this → studio, Design all
// starred → one set, Back to moments, "Brainstorm from my line", free mode.
// Merch7: model / angle switcher on the stage (design only on calibrated
// photos), Quick publish (admins: one tee, stage colour, suggested price,
// rights tick, created hidden), multi-colour publish (colour chips, colors:[…]
// in preview + create, a preview per colour, mockups grouped by colour), the
// new blanks (long sleeve, crewneck, tank, youth, tote; logo inside on tank /
// youth / tote), and Make an ad (feed / story / carousel, AI line from the
// cached copy, line checks, price / link / QR, PNG + .zip downloads, the QR
// read back with the browser's BarcodeDetector when it has one), from
// Publish, the live panel and Your merch.
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
      return { status, body: data, delay: body?.mode === 'concepts' || body?.mode === 'brainstorm-turn' ? slow : 0 };
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
  // An open dialog is audited on its own (the page under it is inert).
  const main = document.querySelector('#main dialog[open]') || document.getElementById('main');
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

// ─── Rail polish: primary, swatches, layout grid, extras, no overflow ─────
async function railChecks(tag, pro) {
  ok(await ev("(() => { const b = document.getElementById('mx-to-setup'); return b.classList.contains('es-btn--primary') && !b.disabled && getComputedStyle(b).color === 'rgb(255, 255, 255)'; })()"), `${tag}: Continue to Publish is the filled primary`);
  ok(await ev("(() => { const d = [...document.querySelectorAll('#mx-pills [data-pill-color]')]; return d.length > 0 && d.every(x => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return r.width <= 28 && r.height <= 28 && Math.abs(r.width - r.height) < 0.5 && (cs.borderRadius === '50%' || parseFloat(cs.borderRadius) >= r.width / 2); }); })()"), `${tag}: pill colour dots are small round swatches`);
  ok(await ev("(() => { const d = [...document.querySelectorAll('#mx-pills .mx-icon')].map(b => b.getBoundingClientRect()); return d.length > 0 && d.every(r => Math.abs(r.width - d[0].width) < 0.5 && Math.abs(r.height - d[0].height) < 0.5); })()"), `${tag}: pill icon buttons share one size`);
  ok(await ev("(() => { const p = document.querySelector('#mx-pills .mx-pill'); if (!p) return false; const i = p.querySelector('[data-pill-text]').getBoundingClientRect(); const s = p.querySelector('.mx-pill__sizes').getBoundingClientRect(); return Math.abs(i.left - s.left) <= 1; })()"), `${tag}: the size control lines up with the pill input`);
  await ev("['layout','extras','colors','text'].forEach(f => document.getElementById('mx-fold-' + f).open = true); true");
  await sleep(150);
  ok(await ev("(() => { const ks = [...document.querySelectorAll('#mx-fold-layout .mx-fit__opts .mx-pal__key')].map(k => k.getBoundingClientRect().top); const cs = [document.getElementById('mx-fit-split'), document.querySelector('#mx-fold-layout .mx-fit__opts .es-segmented')].map(e => e.getBoundingClientRect()); return ks.length === 2 && Math.abs(ks[0] - ks[1]) <= 2 && Math.abs(cs[0].height - cs[1].height) <= 1 && Math.abs(cs[0].top - cs[1].top) <= 1; })()"), `${tag}: Layout labels share a baseline, controls one height`);
  ok(await ev("(() => { const a = document.getElementById('mx-vary').getBoundingClientRect(); const b = document.getElementById('mx-fit-reset'); const r = b.getBoundingClientRect(); return Math.abs(a.top - r.top) <= 1 && Math.abs(a.height - r.height) <= 1 && !b.classList.contains('es-btn--ghost'); })()"), `${tag}: Try other layouts and Reset layout match, one row`);
  ok(await ev("(() => { const f = document.getElementById('mx-fold-extras'); const n = (f.textContent.match(/\\d of 3/g) || []).length; return n === (MerchUI.state.aiMode === 'pro' ? 1 : 0); })()"), `${tag}: Extras count shows once (summary only)`);
  ok(await ev("(() => { const a = document.getElementById('mx-tee-colors-note').textContent.trim(); const h = document.getElementById('mx-tee-colors-hint'); return a.length > 0 && !/Fourthwall/.test(a) && (!h || /colours/.test(h.textContent)); })()"), `${tag}: tee colour name as meta, the source as a hint`);
  ok(await ev("(() => { const t = [...document.querySelectorAll('#mx-tee-colors .mx-swatch')].map(e => e.getBoundingClientRect()); const p = [...document.querySelectorAll('#mx-pal-es .mx-swatch')].map(e => e.getBoundingClientRect()); return t.length && p.length && [...t, ...p].every(r => Math.abs(r.width - t[0].width) < 0.5 && Math.abs(r.height - t[0].height) < 0.5); })()"), `${tag}: tee and pill swatches share one size`);
  ok(await ev("(() => { const k = [...document.querySelectorAll('#mx-fold-colors .mx-pal__line')].filter(l => l.checkVisibility()).map(l => l.firstElementChild.getBoundingClientRect().left); const s = [...document.querySelectorAll('#mx-fold-colors .mx-pal__line')].filter(l => l.checkVisibility()).map(l => l.children[1].getBoundingClientRect().left); return k.length >= 2 && k.every(x => Math.abs(x - k[0]) <= 1) && s.every(x => Math.abs(x - s[0]) <= 1); })()"), `${tag}: colour row labels share a column`);
  ok(await ev("(() => { const c = document.getElementById('mx-pal-custom').getBoundingClientRect(); const h = document.getElementById('mx-pal-hex').getBoundingClientRect(); return Math.abs(c.height - h.height) <= 1; })()"), `${tag}: custom colour well and hex field one height`);
  if (pro) {
    if (!(await ev("document.querySelectorAll('#mx-elements .mx-el').length"))) await click('#mx-el-add [data-el-add=icon]');
    ok(await ev("(() => { const e = document.querySelector('#mx-elements .mx-el'); if (!e) return false; const h = e.querySelector('.mx-el__head'); const f = [...e.querySelectorAll('.mx-el__fields > *')].map(x => x.getBoundingClientRect()); return h && h.querySelector('[data-el-drop]') && f.length >= 2 && Math.abs(f[0].width - f[1].width) <= 1; })()"), `${tag}: an extra is a card: header with remove, options in equal columns`);
    ok(await ev("[...document.querySelectorAll('#mx-el-add [data-el-add]')].every(b => !b.disabled || (b.title && b.querySelector('.es-sr-only')?.textContent.trim()))"), `${tag}: disabled extra chips say why`);
  }
  ok(await ev("(() => { const rail = document.getElementById('mx-rail'); const r = rail.getBoundingClientRect(); const bad = [...rail.querySelectorAll('*')].filter(e => e.checkVisibility() && !e.closest('.mx-pop') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > r.right + 1); return rail.scrollWidth <= rail.clientWidth + 1 && bad.length === 0; })()"), `${tag}: nothing overflows the rail sideways`);
  await ev("document.getElementById('mx-fold-extras').open = false; document.getElementById('mx-fold-layout').open = false; true");
}
// Filmstrip: tiles never overlap each other or New set; badges sit off the art; labels fit or carry a title.
async function filmChecks(tag) {
  ok(await ev("(() => { const tiles = [...document.querySelectorAll('#mx-strip [data-pick]'), document.getElementById('mx-strip-new')].map(e => e.getBoundingClientRect()); return tiles.every((r, i) => tiles.every((q, j) => j === i || r.right <= q.left + 0.5 || r.left >= q.right - 0.5)); })()"), `${tag}: filmstrip tiles never overlap (New set is the last tile)`);
  ok(await ev("[...document.querySelectorAll('#mx-strip [data-pick]')].every(b => { const t = b.querySelector('.mx-film__tags'); if (!t) return true; const a = b.querySelector('.mx-film__img').getBoundingClientRect(); const r = t.getBoundingClientRect(); return r.top >= a.bottom - 0.5 || r.bottom <= a.top + 0.5; })"), `${tag}: badges sit outside the art`);
  ok(await ev("[...document.querySelectorAll('#mx-strip [data-pick] .mx-film__label')].every(l => l.scrollHeight <= l.clientHeight + 1 || l.closest('[title]'))"), `${tag}: tile labels fit or carry the full name`);
}

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
  ok(await ev("!document.querySelector('.mx-hero') && !document.getElementById('mx-text-hint') && document.getElementById('mx-h-content').classList.contains('es-sr-only') && !document.getElementById('mx-content-meta').textContent.trim()"), `${tag}: no hero or hint lines; prompt card first`);
  ok(await ev("document.getElementById('mx-create').disabled"), `${tag}: Create designs starts disabled`);
  ok(await ev("document.querySelector('#mx-mode [data-mode=basic]').matches('[aria-checked=true],[aria-pressed=true]') && MerchUI.state.aiMode === 'basic' && /6 AI designs/.test(document.getElementById('mx-mode-hint').textContent)"), `${tag}: Basic by default with its hint`);
  if (pro) {
    await click('#mx-mode [data-mode=pro]');
    ok(await ev("MerchUI.state.aiMode === 'pro' && localStorage.getItem('frameup.merch.aiMode') === 'pro' && /10 AI designs/.test(document.getElementById('mx-mode-hint').textContent)"), `${tag}: Pro picked, hint and remembered`);
  }
  await click('#mx-url-toggle');
  ok(await ev("document.getElementById('mx-url-toggle').getAttribute('aria-expanded') === 'true'") && await ev(visible('#mx-url')), `${tag}: + ES story link reveals the link field`);
  ok(await ev("!document.getElementById('mx-rules').hidden && document.querySelectorAll('#mx-rules-list li').length >= 3"), `${tag}: How the AI designs lists the ES rules`);
  await until("document.querySelectorAll('#mx-moments .mx-moment[data-mid]').length >= 3", `${tag} moments`);
  ok(calls.includes('moments'), `${tag}: moments called`);
  ok(await ev(`getComputedStyle(document.getElementById('mx-moments')).gridTemplateColumns.split(' ').length === ${width >= 1440 ? 2 : 1} || getComputedStyle(document.getElementById('mx-moments')).gridTemplateColumns.split(' ').length <= 2`), `${tag}: moments in big cards (≤ 2 columns)`);
  ok(await ev("[...document.querySelectorAll('#mx-moments .mx-moment[data-mid]')].every(c => c.querySelector('.mx-moment__sell') && c.querySelectorAll('.mx-mline').length >= 1 && c.querySelectorAll('[data-moment-line]').length === c.querySelectorAll('.mx-mline').length)"), `${tag}: every moment shows why it works and what to print`);
  ok(await ev("document.querySelectorAll('#mx-moments .mx-moment[data-mid]')[0].querySelectorAll('.mx-mline').length === 3 && !!document.querySelector('#mx-moments .mx-moment__who') && !!document.querySelector('#mx-moments .mx-moment__timing')"), `${tag}: AI moments: 3 lines, who buys it, timing`);
  if (await ev("document.querySelectorAll('#mx-moments-sports [data-sport]').length > 2")) {
    await click('#mx-moments-sports [data-sport="NFL"]');
    ok(await ev("document.querySelectorAll('#mx-moments .mx-moment[data-mid]').length === 1"), `${tag}: sport filter`);
    await click('#mx-moments-sports [data-sport=""]');
  }
  await audit(`${tag}-create-empty`);
  await click('#mx-moments .mx-moment[data-mid] [data-moment-line][data-line="1"]');
  ok(await ev("!document.getElementById('mx-moment-chip').hidden && /^\\s*Moment: /.test(document.getElementById('mx-moment-chip').textContent) && document.getElementById('mx-text').value === document.querySelector('#mx-moments .mx-mline.is-on .mx-mline__pill').textContent"), `${tag}: Design this puts that line in the brief and shows the moment chip`);
  await click('#mx-moment-chip [data-chip-clear]');
  ok(await ev("document.getElementById('mx-moment-chip').hidden"), `${tag}: the chip × removes the moment`);
  await click('#mx-moments .mx-moment[data-mid] [data-moment-line][data-line="0"]');
  await setText('#mx-text', 'Ball don’t lie');
  ok(await ev("document.getElementById('mx-text').value === 'Ball don’t lie' && !document.getElementById('mx-moment-chip').hidden"), `${tag}: editing the picked line keeps the moment`);
  ok(!(await ev("document.getElementById('mx-create').disabled")), `${tag}: Create designs enabled`);
  await audit(`${tag}-create`);

  // ── Making: checklist + skeletons + Stop.
  slow = 1500;
  await click('#mx-create');
  await until(`${step('designs')} && MerchUI.state.making && !document.getElementById('mx-making').hidden`, `${tag} making`);
  ok(await ev(`document.querySelectorAll('#mx-making li').length === ${pro ? 5 : 4} && document.querySelectorAll('#mx-making li[data-pro]').length === ${pro ? 1 : 0}`), `${tag}: making checklist (${pro ? 'Pro plans the idea' : 'Basic, 4 steps'})`);
  ok(await ev(visible('#mx-making')) && await ev(visible('#mx-stop')), `${tag}: checklist and Stop visible on the stage`);
  ok(await ev(`document.querySelectorAll('#mx-strip .mx-film__skel').length === ${pro ? 10 : 6}`), `${tag}: skeleton filmstrip`);
  ok(await ev("document.getElementById('mx-to-setup').disabled && document.querySelector('#mx-steps [data-step=publish]').disabled"), `${tag}: Publish locked while making`);
  await audit(`${tag}-making`);
  await until('!MerchUI.state.making && MerchUI.state.concepts.length > 0', `${tag} designs arrive`, 15000);
  slow = 0;
  const cBody = bodies.filter(b => b.mode === 'concepts').pop();
  ok(cBody && cBody.designMode === mode && cBody.content?.text === 'Ball don’t lie' && cBody.trend, `${tag}: concepts gets designMode, trend and content (${JSON.stringify(cBody).slice(0, 160)})`);
  ok(await ev(`MerchUI.state.concepts.length >= 20 && MerchUI.state.concepts.length <= 28 && MerchUI.state.concepts.some(c => c.source === 'style') && document.querySelectorAll('#mx-strip [data-pick]').length === MerchUI.state.concepts.length`), `${tag}: filmstrip has every design (20+ with styles)`);
  ok(await ev("!document.getElementById('mx-strip-filter').hidden"), `${tag}: style filter chips shown`);
  await click('#mx-strip-filter [data-strip-filter="ai"]');
  ok(await ev("document.querySelectorAll('#mx-strip [data-pick]').length === MerchUI.state.concepts.filter(c => c.source !== 'style').length"), `${tag}: AI picks filter`);
  await click('#mx-strip-filter [data-strip-filter="style"]');
  ok(await ev("document.querySelectorAll('#mx-strip [data-pick]').length === MerchUI.state.concepts.filter(c => c.source === 'style').length"), `${tag}: Styles filter`);
  await click('#mx-strip-filter [data-strip-filter="all"]');
  ok(await ev("MerchUI.state.selected === MerchUI.state.concepts[0].id && document.getElementById('mx-making').hidden && document.getElementById('mx-empty-stage').hidden && !document.getElementById('mx-stage-canvas').hidden"), `${tag}: first design on the stage`);
  ok(await ev(visible('#mx-strip-new')), `${tag}: New set tile`);
  await until("/Rights:/.test(document.getElementById('mx-stage-cap').textContent)", `${tag} stage caption with rights`);
  if (pro) ok(await ev("!document.getElementById('mx-idea').hidden"), `${tag}: the idea line (Pro)`);
  await filmChecks(tag);
  // ── Making again over a finished set (New set): nothing stale shows.
  slow = 1500;
  await click('#mx-strip-new');
  await until('MerchUI.state.making', `${tag} making over a set`);
  await sleep(150);
  ok(!(await ev(visible('#mx-angles'))) && !(await ev(visible('#mx-stage-cap'))), `${tag}: making hides the angle strip and the old caption`);
  ok(await ev(`(() => { const n = document.getElementById('mx-strip-new').getBoundingClientRect(); const row = document.querySelector('.mx-filmrow').getBoundingClientRect(); const tiles = [...document.querySelectorAll('#mx-strip .mx-film__skel')].map(e => e.getBoundingClientRect()); return tiles.length === ${pro ? 10 : 6} && tiles.every((r, i) => (r.right <= n.left + 0.5 || r.left >= n.right - 0.5) && tiles.every((q, j) => j === i || r.right <= q.left + 0.5 || r.left >= q.right - 0.5) && Math.abs(r.width - 112) < 1); })()`), `${tag}: skeleton tiles: equal size, none under New set`);
  ok(await ev("document.getElementById('mx-strip-new').disabled"), `${tag}: New set disabled while making`);
  ok(await ev("document.getElementById('mx-rail').getAttribute('aria-busy') === 'true' && document.getElementById('mx-fold-text').inert && !document.getElementById('mx-designs-bar').inert"), `${tag}: rail busy while making (folds inert, action card live)`);
  ok(await ev("(() => { const b = document.getElementById('mx-to-setup'); const l = b.querySelector('span'); const cs = getComputedStyle(b); return b.disabled && /Continue to Publish/.test(b.innerText) && l.getBoundingClientRect().width > 40 && cs.color !== cs.backgroundColor && /Making your designs/.test(document.getElementById('mx-designs-meta').textContent) && document.getElementById('mx-quick').hidden; })()"), `${tag}: Continue keeps its label while making, one status line, no Quick publish`);
  await audit(`${tag}-making-again`);
  await until('!MerchUI.state.making && MerchUI.state.concepts.length > 0', `${tag} set arrives again`, 15000);
  slow = 0;
  await until("document.getElementById('mx-rail').getAttribute('aria-busy') === 'false' && !document.getElementById('mx-fold-text').inert", `${tag} rail live again`);

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
  ok(await ev(`MerchUI.state.concepts.length >= ${nBefore} && MerchUI.state.concepts.some(c => c.variantOf)`), `${tag}: Try other layouts adds variations (styles may already cover them)`);
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
  await railChecks(tag, pro);
  await audit(`${tag}-design`);

  // ── Publish.
  calls.length = 0; bodies.length = 0; stored.length = 0;
  blockPut = theme === 'dark';
  await click('#mx-to-setup');
  await until(`${step('publish')} && document.querySelectorAll('#mx-blanks [data-tpl]').length === ${DEMO.TEMPLATES.length} && document.getElementById('mx-price').value`, `${tag} publish`);
  ok(await ev("!document.querySelector('#mx-steps [data-step=designs]').disabled && !document.querySelector('#mx-steps [data-step=content]').disabled"), `${tag}: done steps stay open`);
  ok(await ev(TEE_ONLY_IN_DESIGN) && await ev("/Black tee/i.test(document.getElementById('mx-pub-color').textContent)") && await ev(visible('#mx-pub-color-change')), `${tag}: read-only colour line with Change`);
  ok(await ev("document.querySelectorAll('#mx-view-publish canvas:not([hidden])').length <= 1"), `${tag}: one preview`);
  await until("document.querySelector('#mx-pstage .mx-pstage__live img') && document.querySelectorAll('#mx-mockups img').length >= 2", `${tag} live mockups (auto)`, 15000);
  ok(calls.filter(c => c === 'upload-url').length >= 1 && calls.includes('preview'), `${tag}: preview asked automatically (${calls.join(',')})`);
  if (blockPut) ok(bodies.some(b => b.mode === 'upload-relay') && stored.every(k => /^merch-art\//.test(k)), `${tag}: upload relay carries a blocked upload`);
  blockPut = false;
  await until("/earn/.test(document.getElementById('mx-earn').textContent)", `${tag} earnings`);
  // UX audit P3 (2026-11-28): no red rights line before an attempt; pressing
  // Create without the tick shows it, moves focus to the box, sends nothing.
  ok(await ev("document.getElementById('mx-pub-blocker').hidden"), `${tag}: no rights warning before an attempt`);
  { const before = bodies.length; await click('#mx-create-fw'); await sleep(300);
    ok(await ev("!document.getElementById('mx-pub-blocker').hidden && /rights/i.test(document.getElementById('mx-pub-blocker').textContent) && document.activeElement?.id === 'mx-ack'"), `${tag}: Create without the tick explains and focuses the rights box`);
    ok(!bodies.slice(before).some(b => b.mode === 'create'), `${tag}: nothing is created without the rights tick`); }
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


// ─── Brainstorm room ──────────────────────────────────────────────────────
const bsN = sel_ => `document.querySelectorAll(${JSON.stringify(sel_)}).length`;
async function brainstormFlow(width, theme, mode) {
  const tag = `${width}-${theme}-${mode}-bs`;
  scenario = 'ok';
  calls.length = 0; bodies.length = 0;
  await load(width, theme, 'bs', mode === 'pro' ? 'pro' : '');
  await until("document.querySelectorAll('#mx-moments [data-moment-brainstorm]').length >= 3", `${tag} moment Brainstorm buttons`);
  ok(await ev("[...document.querySelectorAll('#mx-moments .mx-moment[data-mid]')].every(c => c.querySelector('[data-moment-brainstorm]'))"), `${tag}: every moment card has Brainstorm`);
  ok(await ev("document.getElementById('mx-bs-from-line').hidden"), `${tag}: Brainstorm from my line hidden with an empty brief`);
  await click('[data-moment-brainstorm="m3"]');
  await until(`${step('brainstorm')} && !document.getElementById('mx-view-brainstorm').hidden && MerchUI.state.bs.session && ${bsN('#mx-bs-lines .mx-bsl[data-lid]')} >= 8`, `${tag} board opens`);
  const open = bodies.find(b => b.mode === 'brainstorm-open');
  ok(open && open.trend && open.trend.id === 't2' && open.designMode === mode, `${tag}: open sends the moment's trend and mode (${JSON.stringify(open).slice(0, 120)})`);
  ok(await ev("document.querySelector('#mx-steps [data-step=content]').getAttribute('aria-current') === 'step' && !document.getElementById('mx-steps-crumb').hidden && /Brainstorm/.test(document.getElementById('mx-steps-crumb').textContent)"), `${tag}: steps show Create + Brainstorm crumb`);
  ok(await ev("/Packers/.test(document.getElementById('mx-h-brainstorm').textContent) && document.querySelectorAll('#mx-bs-sources .mx-bs-src.is-on').length === 3 && /Trend/.test(document.getElementById('mx-bs-sources').textContent) && /ES articles/.test(document.getElementById('mx-bs-sources').textContent) && /Web check/.test(document.getElementById('mx-bs-sources').textContent)"), `${tag}: context title and three sources on`);
  ok(await ev("document.querySelectorAll('#mx-bs-ctx-more details').length >= 3 && /people on this board/.test(document.getElementById('mx-bs-people').textContent)"), `${tag}: headlines / ES articles / facts and people count`);
  ok(await ev("document.querySelectorAll('#mx-bs-angles [data-bs-angle]').length === 13 && /Troll \\(in good taste\\)/.test(document.getElementById('mx-bs-angles').textContent)"), `${tag}: 13 angle chips`);
  ok(await ev("document.querySelectorAll('#mx-bs-thread .mx-bs-turn').length >= 5 && document.querySelectorAll('#mx-bs-thread .mx-bs-mbadge').length >= 2"), `${tag}: earlier turns with the mode used`);
  await until(`document.querySelectorAll('#mx-bs-lines canvas.is-drawn').length >= 6`, `${tag} live pill previews`);
  ok(await ev("[...document.querySelectorAll('#mx-bs-lines .mx-bsl[data-lid]')].every(c => c.querySelector('[data-bs-star]') && c.querySelector('[data-bs-more]') && c.querySelector('[data-bs-design]') && c.querySelector('[data-bs-pick]') && c.querySelector('.mx-bsl__by'))"), `${tag}: every line card has star, more like this, design this, mix pick and who added it`);
  ok(await ev("!document.querySelector('#mx-bs-lines [data-lid] [data-bs-edit]') || [...document.querySelectorAll('#mx-bs-lines [data-bs-edit]')].every(b => MerchUI.state.bs.session.lines.find(l => l.id === b.dataset.bsEdit).by === MerchUI.state.bs.me)"), `${tag}: edit only on your own lines`);
  await audit(`${tag}-open`);

  // Ask in words: thinking row + skeletons, then new lines and the turn.
  const n0 = await ev('MerchUI.state.bs.session.lines.length');
  slow = 900;
  await setText('#mx-bs-input', 'play on the snow, Packers fans');
  await click('#mx-bs-send');
  await until("MerchUI.state.bs.busy && document.querySelector('#mx-bs-thread .is-thinking') && document.querySelectorAll('#mx-bs-lines .mx-bsl--skel').length >= 3", `${tag} thinking`);
  ok(await ev("/Basic|Pro/.test(document.querySelector('#mx-bs-thread .is-thinking').textContent)"), `${tag}: thinking row shows the mode`);
  await audit(`${tag}-thinking`);
  await until('!MerchUI.state.bs.busy', `${tag} turn done`);
  slow = 0;
  const turn = bodies.filter(b => b.mode === 'brainstorm-turn').pop();
  ok(turn && turn.prompt === 'play on the snow, Packers fans' && turn.designMode === mode && turn.sessionId, `${tag}: turn sends prompt, mode and session`);
  ok(await ev(`MerchUI.state.bs.session.lines.length >= ${n0 + 4} && document.querySelectorAll('#mx-bs-lines .mx-bsl.is-new').length >= 4`), `${tag}: 4+ new lines, marked new`);
  ok(await ev(`/${mode === 'pro' ? 'Pro' : 'Basic'}/i.test([...document.querySelectorAll('#mx-bs-thread .mx-bs-mbadge')].pop().textContent) && /new line/.test(document.getElementById('mx-bs-thread').textContent)`), `${tag}: the turn's note, new lines link and mode`);
  // Angle chip.
  await click('#mx-bs-angles [data-bs-angle="0"]');
  await until('!MerchUI.state.bs.busy && MerchUI.state.bs.session.turns.length >= 4', `${tag} chip turn`);
  const chip = bodies.filter(b => b.mode === 'brainstorm-turn').pop();
  ok(chip && chip.action && chip.action.kind === 'angle' && chip.action.angle === 'chant', `${tag}: Chant chip sends an angle action`);

  // Star.
  const lid = await ev("document.querySelector('#mx-bs-lines .mx-bsl[data-lid]').dataset.lid");
  await click(`#mx-bs-lines [data-bs-star="${lid}"]`);
  await until(`document.querySelector('#mx-bs-lines [data-bs-star="${lid}"]').getAttribute('aria-pressed') === 'true' && MerchUI.state.bs.session.lines.find(l => l.id === ${JSON.stringify(lid)}).starred.includes(MerchUI.state.bs.me)`, `${tag} star`);
  for (let t = 0; t < 40 && !bodies.some(b => b.mode === 'brainstorm-line' && b.op === 'star' && b.lineId === lid); t++) await sleep(100);
  ok(bodies.some(b => b.mode === 'brainstorm-line' && b.op === 'star' && b.lineId === lid), `${tag}: star saved`);

  // Mix 2.
  ok(await ev("document.getElementById('mx-bs-mixbar').hidden"), `${tag}: no mix bar before picking`);
  await ev("(() => { const p = document.querySelectorAll('#mx-bs-lines [data-bs-pick]'); p[0].click(); return true; })()");
  ok(await ev("!document.getElementById('mx-bs-mixbar').hidden && document.getElementById('mx-bs-mix').disabled"), `${tag}: one pick shows the bar, Mix waits`);
  await ev("(() => { const p = document.querySelectorAll('#mx-bs-lines [data-bs-pick]'); p[1].click(); return true; })()");
  ok(await ev("!document.getElementById('mx-bs-mix').disabled && /Mix 2/.test(document.getElementById('mx-bs-mix').textContent)"), `${tag}: Mix 2 appears with two picks`);
  await audit(`${tag}-mix`);
  await click('#mx-bs-mix');
  await until("!MerchUI.state.bs.busy && MerchUI.state.bs.picks.length === 0", `${tag} mix turn`);
  const mix = bodies.filter(b => b.mode === 'brainstorm-turn').pop();
  ok(mix && mix.action?.kind === 'mix' && mix.action.lineIds?.length === 2, `${tag}: Mix sends two line ids`);

  // More like this.
  await click('#mx-bs-lines [data-bs-more]');
  await until("!MerchUI.state.bs.busy", `${tag} more like this`);
  ok(bodies.filter(b => b.mode === 'brainstorm-turn').pop()?.action?.kind === 'more-like', `${tag}: More like this sends more-like`);

  // Add your own line, then edit it.
  const own = `Lambeau loud ${width}${theme}`;
  await setText('#mx-bs-add-input', own);
  await ev("document.getElementById('mx-bs-add').requestSubmit(); true");
  await until(`MerchUI.state.bs.session.lines.some(l => l.text === ${JSON.stringify(own)} && l.source === 'person')`, `${tag} own line`);
  ok(await ev(`[...document.querySelectorAll('#mx-bs-lines .mx-bsl')].some(c => c.querySelector('.mx-bsl__text')?.textContent === ${JSON.stringify(own)} && /Own line/.test(c.textContent) && c.querySelector('[data-bs-edit]') && c.querySelector('[data-bs-remove]'))`), `${tag}: own line on the board, editable`);
  const ownId = await ev(`MerchUI.state.bs.session.lines.find(l => l.text === ${JSON.stringify(own)}).id`);
  await click(`#mx-bs-lines [data-bs-edit="${ownId}"]`);
  await until("document.querySelector('#mx-bs-lines [data-bs-edit-input]')", `${tag} edit field`);
  await ev(`(() => { const i = document.querySelector('#mx-bs-lines [data-bs-edit-input]'); i.value = ${JSON.stringify(own + ' x')}; i.closest('form').requestSubmit(); return true; })()`);
  await until(`MerchUI.state.bs.session.lines.some(l => l.id === ${JSON.stringify(ownId)} && l.text === ${JSON.stringify(own + ' x')}) && !document.querySelector('#mx-bs-lines [data-bs-edit-input]')`, `${tag} edit saved`);

  // A teammate's line arrives on the refresh (brainstorm-get, no AI).
  const sid = await ev('MerchUI.state.bs.session.id');
  DEMO.teammateAdds(sid, `MAYA WAS HERE ${width}${theme}`);
  calls.length = 0;
  await ev('MerchUI.bsRefresh(); true');
  await until(`[...document.querySelectorAll('#mx-bs-lines .mx-bsl__text')].some(t => t.textContent === ${JSON.stringify(`MAYA WAS HERE ${width}${theme}`)})`, `${tag} teammate line`);
  ok(calls.includes('brainstorm-get') && !calls.includes('brainstorm-open'), `${tag}: refresh uses brainstorm-get (${calls.join(',')})`);

  // Filters and sort.
  await click('#mx-bs-filter [data-bs-filter="starred"]');
  ok(await ev("[...document.querySelectorAll('#mx-bs-lines .mx-bsl[data-lid]')].every(c => Number(c.querySelector('[data-bs-star] span').textContent) > 0)"), `${tag}: Starred filter`);
  await click('#mx-bs-filter [data-bs-filter="mine"]');
  ok(await ev("[...document.querySelectorAll('#mx-bs-lines .mx-bsl[data-lid]')].every(c => MerchUI.state.bs.session.lines.find(l => l.id === c.dataset.lid).by === MerchUI.state.bs.me)"), `${tag}: Mine filter`);
  await click('#mx-bs-filter [data-bs-filter="all"]');
  await ev("(() => { const s = document.getElementById('mx-bs-sort'); s.value = 'stars'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  ok(await ev("(() => { const n = [...document.querySelectorAll('#mx-bs-lines [data-bs-star] span')].map(x => Number(x.textContent)); return n.every((v, i) => i === 0 || n[i - 1] >= v); })()"), `${tag}: Most starred sort`);
  await audit(`${tag}-board`);

  // Design this → the studio (no AI call).
  const dl = await ev("MerchUI.state.bs.session.lines.find(l => l.text === 'FROZEN TUNDRA')?.id");
  calls.length = 0;
  await click(`#mx-bs-lines [data-bs-design="${dl}"]`);
  await until(`${step('designs')} && MerchUI.state.concepts.length >= 1 && document.querySelectorAll('#mx-strip [data-pick]').length >= 1`, `${tag} design this`);
  ok(await ev("MerchUI.state.concepts[0].title === 'FROZEN TUNDRA' && MerchUI.state.concepts[0].palette.a === '#203731' && MerchUI.state.concepts[0].rights.some(r => r.kind === 'nickname')"), `${tag}: Design this: the line in Packers colours with its rights`);
  ok(!calls.includes('concepts') && await ev("/From the brainstorm/.test(document.getElementById('mx-made-mode').textContent) && !document.getElementById('mx-idea').hidden"), `${tag}: no AI call; From the brainstorm + the idea line`);
  await audit(`${tag}-design-this`);

  // Back to the board, then Design all starred → one set.
  await click('#mx-steps [data-step=content]');
  await click('[data-moment-brainstorm="m3"]');
  await until(`${step('brainstorm')} && MerchUI.state.bs.session`, `${tag} board again`);
  const starred = await ev('MerchUI.state.bs.session.lines.filter(l => l.starred.length).length');
  ok(starred >= 4 && await ev(`!document.getElementById('mx-bs-design-starred').disabled && /\\(${starred}\\)/.test(document.getElementById('mx-bs-design-starred').textContent)`), `${tag}: Design all starred (${starred})`);
  await click('#mx-bs-design-starred');
  await until(`${step('designs')} && MerchUI.state.concepts.length === ${Math.min(12, starred)}`, `${tag} starred set`);
  ok(await ev("MerchUI.state.concepts.every(c => c.palette.a === '#203731' && c.id.startsWith('bs-'))"), `${tag}: every starred line is a design in the trend's palette`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} set continue`);

  // Back to moments from the board.
  await click('#mx-steps [data-step=content]');
  await click('[data-moment-brainstorm="m3"]');
  await until(step('brainstorm'), `${tag} board third time`);
  await click('#mx-bs-back');
  ok(await ev(`${step('content')} && document.activeElement?.dataset?.momentBrainstorm === 'm3'`), `${tag}: Back to moments lands on the moment`);

  // From my line (no trend).
  await setText('#mx-text', 'We center fans');
  ok(await ev("!document.getElementById('mx-bs-from-line').hidden"), `${tag}: Brainstorm from my line shows with a brief`);
  bodies.length = 0;
  await click('#mx-bs-from-line');
  await until(`${step('brainstorm')} && MerchUI.state.bs.session && !MerchUI.state.bs.opening`, `${tag} from line`);
  const fl = bodies.find(b => b.mode === 'brainstorm-open');
  ok(fl && fl.content?.text === 'We center fans', `${tag}: from my line sends the brief`);
  ok(await ev("document.querySelectorAll('#mx-bs-sources .mx-bs-src:not(.is-on)').length === 2 && /Your line/.test(document.querySelector('#mx-bs-sources .mx-bs-src.is-on').textContent) && document.querySelector('#mx-bs-lines .es-empty') && /We center fans/.test(document.getElementById('mx-h-brainstorm').textContent)"), `${tag}: a new line board: your line, sources off, empty state`);
  await audit(`${tag}-from-line`);
  await click('#mx-bs-back');
}
async function brainstormStates(width, theme) {
  const tag = `${width}-${theme}-bs`;
  scenario = 'free';
  await load(width, theme, 'bsfree');
  await until("document.querySelector('[data-moment-brainstorm=\"m3\"]')", `${tag} free moments`);
  await click('[data-moment-brainstorm="m3"]');
  await until(`${step('brainstorm')} && MerchUI.state.bs.session`, `${tag} free open`);
  await click('#mx-bs-angles [data-bs-angle="1"]');
  await until('!MerchUI.state.bs.busy && MerchUI.state.bs.session.turns.length >= 3', `${tag} free turn`);
  ok(await ev("/No AI/.test([...document.querySelectorAll('#mx-bs-thread .mx-bs-mbadge')].pop().textContent) && /Free mode/.test(document.getElementById('mx-bs-thread').textContent) && /Quick pick/.test(document.getElementById('mx-bs-lines').textContent)"), `${tag}: free mode turn says No AI, Quick pick lines`);
  await audit(`${tag}-free`);
  scenario = 'error';
  await load(width, theme, 'bserr');
  await ev("MerchUI.brainstorm({ trend: { id: 't2', title: 'Sample' } }); true");
  await until("!document.getElementById('mx-bs-open-error').hidden && document.querySelector('[data-bs-retry-open]')", `${tag} open error with retry`);
  await audit(`${tag}-error`);
}

// ─── Merch7: angles, Quick publish, ads, colours, new blanks ───────────────
const adOpen = "document.getElementById('mx-ad').open";
async function adFlow(tag, { live }) {
  await until(`${adOpen} && document.querySelectorAll('#mx-ad-frames canvas.is-drawn').length >= 1 && document.getElementById('mx-ad-frames').getAttribute('aria-busy') === 'false'`, `${tag} ad drawn`, 20000);
  ok(await ev("document.getElementById('mx-ad-line').value.length > 3 && !document.getElementById('mx-ad-line-note').classList.contains('is-bad')"), `${tag}: ad line filled (${await ev("document.getElementById('mx-ad-line').value")})`);
  ok(await ev("document.querySelectorAll('#mx-ad-pics [data-ad-pic]').length >= 2"), `${tag}: lead image choices`);
  ok(await ev(`document.querySelector('[data-ad-opt=link]').disabled === ${!live} && document.querySelector('[data-ad-opt=qr]').disabled === ${!live}`), `${tag}: link and QR ${live ? 'on offer' : 'wait for the product link'}`);
  ok(await ev("(() => { const c = document.querySelector('#mx-ad-frames canvas'); return Math.abs(c.height / c.width - 1350 / 1080) < 0.02; })()"), `${tag}: feed is 4:5`);
  await audit(`${tag}-ad-feed`);
  // Line checks.
  await setText('#mx-ad-line', 'The official tee');
  ok(await ev("document.getElementById('mx-ad-line-note').classList.contains('is-bad') && /official/i.test(document.getElementById('mx-ad-line-note').textContent)"), `${tag}: "official" is refused`);
  await setText('#mx-ad-line', 'Ninety 99 nights');
  ok(await ev("/Numbers/.test(document.getElementById('mx-ad-line-note').textContent)"), `${tag}: invented numbers are refused`);
  await click('#mx-ad-line-reset');
  ok(await ev("!document.getElementById('mx-ad-line-note').classList.contains('is-bad')"), `${tag}: Reset brings the suggested line back`);
  // Story.
  await click('#mx-ad-format [data-ad-format=story]');
  await until("(() => { const c = document.querySelector('#mx-ad-frames canvas.is-drawn'); return c && Math.abs(c.height / c.width - 1920 / 1080) < 0.02 && document.getElementById('mx-ad-frames').getAttribute('aria-busy') === 'false'; })()", `${tag} story`, 15000);
  ok(true, `${tag}: story is 9:16`);
  // Carousel.
  await click('#mx-ad-format [data-ad-format=carousel]');
  await until("document.getElementById('mx-ad-frames').dataset.format === 'carousel' && document.querySelectorAll('#mx-ad-frames canvas.is-drawn').length >= 3 && document.getElementById('mx-ad-frames').getAttribute('aria-busy') === 'false'", `${tag} carousel`, 20000);
  ok(await ev("(() => { const n = document.querySelectorAll('#mx-ad-frames canvas').length; return n >= 3 && n <= 5 && new RegExp('Download ' + n + ' slides').test(document.getElementById('mx-ad-download').textContent); })()"), `${tag}: carousel 3–5 slides, download says how many`);
  await audit(`${tag}-ad-carousel`);
  if (live) {
    await click('[data-ad-opt=qr]');
    ok(await ev("MerchAds.state.qr && /^data:image\\/png/.test(MerchAds.state.qrSrc)"), `${tag}: QR on`);
    const read = await ev(`(async () => { if (!('BarcodeDetector' in window)) return 'skip'; try { const img = new Image(); img.src = MerchAds.state.qrSrc; await img.decode(); const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(img); return r[0]?.rawValue || 'none'; } catch (e) { return 'skip'; } })()`);
    ok(read === 'skip' || read === await ev('MerchAds.state.url'), `${tag}: the QR reads back as the product link (${read})`);
  }
  // Downloads (captured, not saved).
  await ev("window.__mxSaved = []; window.__mxAdSave = (b, n) => { window.__mxSaved.push({ n, size: b.size, type: b.type, b }); }; true");
  await click('#mx-ad-download');
  await until("window.__mxSaved.length >= 1", `${tag} carousel zip`, 30000);
  ok(await ev("(async () => { const s = window.__mxSaved[0]; const h = new Uint8Array(await s.b.slice(0, 2).arrayBuffer()); return /\\.zip$/.test(s.n) && s.size > 1000 && h[0] === 0x50 && h[1] === 0x4B; })()"), `${tag}: carousel downloads as a .zip of PNGs`);
  await click('#mx-ad-format [data-ad-format=feed]');
  await click('#mx-ad-download');
  await until("window.__mxSaved.length >= 2", `${tag} feed png`, 20000);
  ok(await ev("(async () => { const s = window.__mxSaved[1]; const h = new Uint8Array(await s.b.slice(1, 4).arrayBuffer()); return /feed-1080x1350\\.png$/.test(s.n) && String.fromCharCode(...h) === 'PNG'; })()"), `${tag}: feed downloads as a 1080×1350 PNG`);
  ok(calls.filter(c => c === 'copy').length <= 1, `${tag}: no extra AI call for the ad (${calls.filter(c => c === 'copy').length} copy)`);
  await ev("document.getElementById('mx-ad').close(); delete window.__mxAdSave; true");
}
// Zoom viewer: open, hi-res render, zoom, pan, angle inside, close + focus back.
async function zoomChecks(tag) {
  ok(await ev("!document.getElementById('mx-zoom-open').disabled"), `${tag}: zoom button ready`);
  await click('#mx-zoom-open');
  await until("document.getElementById('mx-zoom').open && document.getElementById('mx-zoom').contains(document.activeElement)", `${tag} zoom opens with focus inside`);
  await until("document.getElementById('mx-zoom-canvas').dataset.hires === '1600' && document.getElementById('mx-zoom-busy').hidden", `${tag} zoom draws the larger render`, 15000);
  ok(await ev("document.getElementById('mx-zoom-level').textContent === '100%' && document.getElementById('mx-zoom-out').disabled && /\\S/.test(document.getElementById('mx-zoom-cap').textContent)"), `${tag}: zoom starts at 100% with a caption`);
  await audit(`${tag}-zoom`);
  await click('#mx-zoom-in');
  ok(await ev("document.getElementById('mx-zoom-level').textContent === '150%'"), `${tag}: + zooms in`);
  await ev("document.getElementById('mx-zoom-view').focus(); true");
  await key('+');
  ok(await ev("document.getElementById('mx-zoom-level').textContent === '225%'"), `${tag}: + key zooms in`);
  await key('ArrowRight');
  ok(await ev("/translate\\(-\\d/.test(document.getElementById('mx-zoom-canvas').style.transform)"), `${tag}: arrows pan`);
  await ev(`(() => { const v = document.getElementById('mx-zoom-view'); const r = v.getBoundingClientRect(); const o = { bubbles: true, pointerId: 7, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; v.dispatchEvent(new PointerEvent('pointerdown', o)); v.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: o.clientX + 60, clientY: o.clientY + 40 })); v.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()`);
  ok(await ev("(() => { const m = document.getElementById('mx-zoom-canvas').style.transform.match(/translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\)/); return m && Number(m[2]) > 0; })()"), `${tag}: drag pans`);
  await key('0');
  ok(await ev("document.getElementById('mx-zoom-level').textContent === '100%' && /translate\\(0px, 0px\\) scale\\(1\\)/.test(document.getElementById('mx-zoom-canvas').style.transform)"), `${tag}: 0 resets`);
  await ev("(() => { const v = document.getElementById('mx-zoom-view'); const r = v.getBoundingClientRect(); v.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -60, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); return true; })()");
  ok(await ev("parseInt(document.getElementById('mx-zoom-level').textContent, 10) > 100"), `${tag}: pinch / ctrl+wheel zooms`);
  if (await ev("document.querySelectorAll('#mx-zoom-angles [data-angle-i]').length >= 2")) {
    const before = await ev('MerchUI.state.photoAt?.index ?? 0');
    await ev("(() => { const b = [...document.querySelectorAll('#mx-zoom-angles [data-angle-i]')].find(x => x.getAttribute('aria-checked') !== 'true'); b.click(); return true; })()");
    await until(`(MerchUI.state.photoAt?.index ?? 0) !== ${before} && document.getElementById('mx-zoom').open`, `${tag} angle from the zoom`);
    ok(true, `${tag}: angles work inside the zoom`);
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until("!document.getElementById('mx-zoom').open", `${tag} Esc closes the zoom`);
  ok(await until("document.activeElement && document.activeElement.id === 'mx-zoom-open'", `${tag} focus back`, 2000), `${tag}: focus goes back to the zoom button`);
  await click('#mx-angles [data-angle-i="0"]');
  await ev("document.getElementById('mx-stage-canvas').click(); true");
  await until("document.getElementById('mx-zoom').open", `${tag} a click on the stage opens the zoom`);
  await ev("document.getElementById('mx-zoom-close').click(); true");
  await until("!document.getElementById('mx-zoom').open", `${tag} close button`);
}

// ── tote-drag: move / resize on the tote's perspective photo (merch-canvas.js).
// The overlay is the design box's 4 projected corners (an SVG polygon) and must
// sit where photoMock draws the ink (within 3 canvas px at the corners), a drag
// inside the quad moves it (fit.xIn / fit.yIn), a corner handle resizes it
// (fit.scale, opposite corner held), a press outside the quad does nothing, and
// hard goods never grow past 100%.
const TOTE_OVERLAY = `(() => {
  const cv = document.getElementById('mx-stage-canvas'); const ctl = MerchUI.canvas;
  const poly = document.querySelector('.mx-cv__quad polygon'); const svg = document.querySelector('.mx-cv__quad');
  if (!ctl || !ctl.quad() || !poly || svg.hasAttribute('hidden')) return null;
  const r = cv.getBoundingClientRect(); const cs = getComputedStyle(cv);
  let sx = r.width / cv.width, sy = r.height / cv.height;
  if (cs.objectFit === 'contain' || cs.objectFit === 'scale-down') sx = sy = Math.min(sx, sy);
  const ox = r.left + (r.width - cv.width * sx) / 2, oy = r.top + (r.height - cv.height * sy) / 2;
  const sr = svg.getBoundingClientRect();
  const client = poly.getAttribute('points').trim().split(' ').filter(Boolean).map(p => p.split(',').map(Number)).map(([x, y]) => ({ x: sr.left + x, y: sr.top + y }));
  const dom = client.map(p => ({ x: (p.x - ox) / sx, y: (p.y - oy) / sy }));
  const he = document.querySelector('.mx-cv__h[data-corner=se]').getBoundingClientRect();
  return { quad: ctl.quad(), dom, client, se: { x: he.left + he.width / 2, y: he.top + he.height / 2 }, ox, oy, sx, sy, fit: JSON.parse(JSON.stringify(MerchUI.state.concepts.find(c => c.id === MerchUI.state.selected).fit || {})), st: ctl.state() };
})()`;
// Where photoMock puts the ink: the same concept in one dark colour on a plain
// photo (strap cut-out off), every ink pixel mapped back to inches, the extremes
// projected to the canvas, compared with the overlay corners.
const TOTE_INK = `(async () => {
  const P = window.MerchPrint, ctl = MerchUI.canvas, st = ctl.state(), cv = document.getElementById('mx-stage-canvas');
  const c = JSON.parse(JSON.stringify(MerchUI.state.concepts.find(x => x.id === MerchUI.state.selected)));
  c.palette = { a: '#111111', b: '#111111', ink: '#111111' };
  c.stack = (c.stack || []).map(r => ({ ...r, fill: 'a', ink: 'ink' }));
  const W = cv.width, H = cv.height;
  const ph = document.createElement('canvas'); ph.width = W; ph.height = H; const pg = ph.getContext('2d'); pg.fillStyle = '#f4f4f4'; pg.fillRect(0, 0, W, H);
  const cal = P.PHOTO_QUADS.pro_367[st.view.photoIndex || 0]; const cover = cal.cover; cal.cover = [];
  const off = document.createElement('canvas'); off.width = W;
  try { await P.photoMock(c, off, { photo: ph.toDataURL('image/png'), kind: 'tote', templateId: 'pro_367', photoIndex: st.view.photoIndex || 0, spec: st.view.spec, garmentColor: '#FFFFFF', realism: false, logoSpot: 'inline' }); } finally { cal.cover = cover; }
  const g = P.photoGeometry('pro_367', st.view.photoIndex || 0, off.width, off.height, { inW: 10, inH: 10 });
  const d = off.getContext('2d').getImageData(0, 0, off.width, off.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
  for (let y = 0; y < off.height; y++) for (let x = 0; x < off.width; x++) { const i = (y * off.width + x) * 4; if (d[i] > 90 || d[i + 3] < 200) continue; n++; const [a, b] = g.toInches(x + 0.5, y + 0.5); if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
  const ink = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([a, b]) => g.toCanvas(a, b));
  const q = ctl.quad();
  const err = Math.max(...q.map((p, k) => Math.hypot(p.x - ink[k][0], p.y - ink[k][1])));
  return { n, err, same: off.width === W && off.height === H, inkIn: [x0, y0, x1, y1].map(v => Math.round(v * 100) / 100), box: st.box };
})()`;
const mouseAt = (type, x, y, down = false) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : (down || type === 'mousePressed' ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
async function mouseDrag(from, dx, dy, { steps = 8, mid = null } = {}) {
  await mouseAt('mouseMoved', from.x, from.y);
  await mouseAt('mousePressed', from.x, from.y);
  let seen = null;
  for (let i = 1; i <= steps; i++) {
    await mouseAt('mouseMoved', from.x + (dx * i) / steps, from.y + (dy * i) / steps, true);
    await sleep(25);
    if (mid && i === Math.ceil(steps / 2)) seen = await ev(mid);
  }
  await sleep(40);
  await mouseAt('mouseReleased', from.x + dx, from.y + dy);
  await sleep(150);
  return seen;
}
async function toteCanvas(tag) {
  await ev("MerchUI.go('designs'); true");
  await until(`${step('designs')} && MerchUI.state.templateId === 'pro_367' && MerchUI.state.view === 'tee' && MerchUI.state.stagePic === 'photo'`, `${tag} tote photo on the stage`, 15000);
  await until(`(${TOTE_OVERLAY}) !== null`, `${tag} tote overlay`, 8000);
  await sleep(200);
  let o = await ev(TOTE_OVERLAY);
  ok(o && o.st.map === 'proj' && o.st.canMove && o.st.yMode && o.st.hasX && o.st.limits.scaleMax === 1, `${tag}: tote: projective overlay, moves both ways, scale capped at 100% (${JSON.stringify(o && { map: o.st.map, canMove: o.st.canMove, yMode: o.st.yMode, max: o.st.limits.scaleMax })})`);
  const domErr = o => Math.max(...o.quad.map((p, k) => Math.hypot(p.x - o.dom[k].x, p.y - o.dom[k].y)));
  ok(o && domErr(o) <= 1, `${tag}: tote: the SVG quad sits on the projected corners (${o && domErr(o).toFixed(2)} canvas px)`);
  ok(o && Math.abs(o.quad[0].y - o.quad[1].y) > 1 && (o.quad[3].y - o.quad[0].y) > (o.quad[2].y - o.quad[1].y), `${tag}: tote: the overlay is a perspective quad (near edge taller), not a rectangle`);
  const notes = [];
  let ink = await ev(TOTE_INK);
  notes.push(`ink ${ink.err.toFixed(2)}px`);
  ok(ink.same && ink.n > 500 && ink.err <= 3, `${tag}: tote: overlay corners match where photoMock draws the design (worst ${ink.err.toFixed(2)} canvas px, ${ink.n} ink px)`);
  // Move: drag inside the quad 30 px right, 40 px down.
  const f0 = o.fit, q0 = o.quad;
  const c0 = { x: o.client.reduce((a, p) => a + p.x, 0) / 4, y: o.client.reduce((a, p) => a + p.y, 0) / 4 };
  const mid = await mouseDrag(c0, 30, 40, { mid: "({ dragging: document.querySelector('.mx-cv').classList.contains('is-dragging'), shown: !document.querySelector('.mx-cv').hidden, stroke: getComputedStyle(document.querySelector('.mx-cv__quad polygon')).strokeOpacity })" });
  ok(mid && mid.dragging && mid.shown && mid.stroke === '1', `${tag}: tote: the quad outline shows while dragging (${JSON.stringify(mid)})`);
  await until(`(() => { const o = ${TOTE_OVERLAY}; return o && Math.abs(o.quad[0].y - ${q0[0].y}) > 2; })()`, `${tag} tote overlay moved`);
  await sleep(300);
  o = await ev(TOTE_OVERLAY);
  ok(o.fit.yIn > 0.3 && o.fit.xIn > 0.2 && o.quad[0].y > q0[0].y + 2 && o.quad[0].x > q0[0].x + 2, `${tag}: tote: dragging moves the design right and down (fit ${JSON.stringify(f0)} -> ${JSON.stringify(o.fit)})`);
  ink = await ev(TOTE_INK);
  notes.push(`moved ${JSON.stringify(o.fit)} ink ${ink.err.toFixed(2)}px`);
  ok(ink.err <= 3, `${tag}: tote: after the move the overlay still matches the drawn ink (${ink.err.toFixed(2)} px)`);
  ok(ink.box.x >= -0.01 && ink.box.y >= -0.01 && ink.box.x + ink.box.w <= 10.01 && ink.box.y + ink.box.h <= 10.01, `${tag}: tote: the moved design stays inside the 10 x 10 in area (${JSON.stringify(ink.box)})`);
  ok(await ev(`(() => { const c = MerchUI.state.concepts.find(x => x.id === MerchUI.state.selected); return MerchPrint.checks(c, { pixelsWidth: 1500, pixelsHeight: 1500, dpi: 150, kind: 'tote', regionId: 'front', logo: 'inside' }).every(k => k.level !== 'error'); })()`), `${tag}: tote: the moved design passes the print checks`);
  // Resize from the se handle toward the centre: smaller, the nw corner holds.
  const f1 = o.fit, q1 = o.quad;
  await mouseDrag(o.se, -24, -24);
  await until(`(() => { const o = ${TOTE_OVERLAY}; return o && o.fit.scale < ${f1.scale}; })()`, `${tag} tote resized`);
  await sleep(300);
  o = await ev(TOTE_OVERLAY);
  const held = Math.hypot(o.quad[0].x - q1[0].x, o.quad[0].y - q1[0].y);
  ok(o.fit.scale < f1.scale && held <= 3, `${tag}: tote: corner resize changes fit.scale (${f1.scale} -> ${o.fit.scale}) and holds the opposite corner (${held.toFixed(2)} canvas px)`);
  ink = await ev(TOTE_INK);
  notes.push(`resized scale ${o.fit.scale} corner held ${held.toFixed(2)}px ink ${ink.err.toFixed(2)}px`);
  ok(ink.err <= 3, `${tag}: tote: after the resize the overlay matches the drawn ink (${ink.err.toFixed(2)} px)`);
  // A press inside the box round the quad but outside the quad does not grab.
  const f2 = o.fit;
  // (the sloping top edge: 30% along it, 2 px above it; well clear of the handles)
  const [qa, qb] = o.quad;
  const corner = { x: qa.x + 0.3 * (qb.x - qa.x), y: qa.y + 0.3 * (qb.y - qa.y) - 2 };
  const ys = o.quad.map(p => p.y);
  const outside = corner.y > Math.min(...ys) && await ev(`!MerchCanvas.pointInQuad(${JSON.stringify(corner)}, MerchUI.canvas.quad())`);
  await mouseDrag({ x: o.ox + corner.x * o.sx, y: o.oy + corner.y * o.sy }, 20, 20);
  await sleep(200);
  ok(outside && JSON.stringify((await ev(TOTE_OVERLAY)).fit) === JSON.stringify(f2), `${tag}: tote: a press outside the quad leaves the design alone`);
  if (await ev("document.getElementById('mx-zoom').open")) { await ev("document.getElementById('mx-zoom-close').click(); true"); await until("!document.getElementById('mx-zoom').open", `${tag} zoom closed`); }
  // Keys: ArrowUp moves up 0.1 in; 0 resets; + never goes past 100%.
  await ev("document.querySelector('.mx-cv__box').focus(); true");
  await key('ArrowUp');
  await sleep(150);
  ok(Math.abs((await ev(TOTE_OVERLAY)).fit.yIn - (f2.yIn - 0.1)) < 0.02, `${tag}: tote: ArrowUp moves the design 0.1 in up`);
  await ev("document.querySelector('.mx-cv__box').focus(); true");
  await key('0');
  await sleep(150);
  await ev("document.querySelector('.mx-cv__box').focus(); true");
  await key('+');
  await sleep(150);
  const fr = (await ev(TOTE_OVERLAY)).fit;
  ok(fr.scale === 1 && fr.yIn === 0 && fr.xIn === 0, `${tag}: tote: 0 resets, + stops at 100% (${JSON.stringify(fr)})`);
  console.log(`${tag} tote canvas: ${notes.join('; ')}`);
  await audit(`${tag}-tote-canvas`);
}

async function merch7(width, theme) {
  const tag = `${width}-${theme}-m7`;
  scenario = 'ok';
  calls.length = 0; bodies.length = 0;
  await load(width, theme, 'm7');
  await until('MerchUI.state.status', `${tag} status`);
  await quickDesigns(tag);
  // ── Model / angle switcher (White tee: four Fourthwall photos).
  await until("document.querySelectorAll('#mx-angles [data-angle-i]').length >= 3", `${tag} angle switcher`);
  ok(await ev("document.querySelector('#mx-angles [aria-checked=true]') && document.getElementById('mx-angles').getAttribute('role') === 'radiogroup' && document.querySelectorAll('#mx-angles .mx-angle.is-drawn').length >= 1"), `${tag}: switcher opens on a photo with the design`);
  ok(await ev("(() => { const p = [...document.querySelectorAll('#mx-angles .mx-angle__pic')].map(e => e.getBoundingClientRect()); return p.length >= 2 && p.every(r => Math.abs(r.width - p[0].width) < 0.5 && Math.abs(r.height - p[0].height) < 0.5); })()"), `${tag}: angle thumbnails all one size (picked one too)`);
  ok(await ev("(() => { const l = [...document.querySelectorAll('#mx-angles .mx-angle__label')].map(e => e.textContent.trim()); return l.length >= 2 && new Set(l).size === l.length; })()"), `${tag}: angle labels are unique (${await ev("[...document.querySelectorAll('#mx-angles .mx-angle__label')].map(e => e.textContent.trim()).join(', ')")})`);
  ok(await ev("(() => { const b = [...document.querySelectorAll('#mx-angles .mx-angle')].map(e => e.getBoundingClientRect()); const c = document.getElementById('mx-stage-canvas').getBoundingClientRect(); const mid = (Math.min(...b.map(r => r.left)) + Math.max(...b.map(r => r.right))) / 2; return Math.abs(mid - (c.left + c.right) / 2) <= 4; })()"), `${tag}: angle strip centred under the stage image`);
  ok(await ev("[...document.querySelectorAll('#mx-angles .mx-angle')].every(b => /design shown on this photo|photo only/.test(b.title))"), `${tag}: every angle says whether the design is on it`);
  await until("[...document.querySelectorAll('#mx-angles .mx-angle.is-drawn img')].some(i => i.src.startsWith('data:'))", `${tag} angle thumbnails with the design`);
  await zoomChecks(tag);
  const plain = await ev("document.querySelector('#mx-angles .is-plain')?.dataset.angleI ?? ''");
  if (plain !== '') {
    await click(`#mx-angles [data-angle-i="${plain}"]`);
    await until("/Fourthwall’s mockups/.test(document.getElementById('mx-stage-cap').textContent)", `${tag} plain photo caption`);
    ok(true, `${tag}: a photo without a print area shows Fourthwall's photo and says so`);
  }
  await click('#mx-angles [data-angle-i="0"]');
  await audit(`${tag}-angles`);
  // ── Quick publish.
  await until(`${visible('#mx-quick')} && !document.getElementById('mx-quick').disabled`, `${tag} quick publish button`);
  ok(await ev("!document.getElementById('mx-quick').classList.contains('es-btn--primary')"), `${tag}: Quick publish is not a second primary`);
  await click('#mx-quick');
  await until("document.getElementById('mx-quick-dlg').open && /T-shirt/.test(document.getElementById('mx-quick-facts').textContent) && /\\$25\\.99/.test(document.getElementById('mx-quick-facts').textContent)", `${tag} quick dialog`);
  ok(await ev("document.getElementById('mx-quick-go').disabled"), `${tag}: Create hidden waits for the rights tick`);
  await audit(`${tag}-quick`);
  await click('#mx-quick-ack');
  await until("!document.getElementById('mx-quick-go').disabled", `${tag} quick ready`);
  calls.length = 0; bodies.length = 0;
  await click('#mx-quick-go');
  await until("!document.getElementById('mx-live').hidden && /Hidden/.test(document.querySelector('#mx-live .es-badge')?.textContent || '')", `${tag} quick created`, 25000);
  const qb = bodies.find(b => b.mode === 'create');
  ok(qb && qb.blank === 'tee' && qb.colors?.length === 1 && qb.colors[0] === qb.color && qb.retail === 25.99 && qb.ack?.accepted === true, `${tag}: Quick publish creates one tee, one colour, suggested price (${JSON.stringify({ b: qb?.blank, c: qb?.colors, r: qb?.retail })})`);
  ok(!calls.includes('preview'), `${tag}: Quick publish skips the preview round trip (${calls.join(',')})`);
  ok(await ev("/publish it to the shop/i.test(document.querySelector('#mx-live .mx-live__next').textContent)"), `${tag}: the live panel says what to do next`);
  // ── Make an ad from the live panel.
  await click('#mx-live [data-live=ad]');
  await adFlow(`${tag}-live`, { live: true });
  // ── Multi-colour publish on another design.
  await click('#mx-steps [data-step=designs]');
  await ev(`(() => { const b = document.querySelectorAll('#mx-strip [data-pick]')[1]; b.click(); return true; })()`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} continue`);
  calls.length = 0; bodies.length = 0;
  await click('#mx-to-setup');
  await until(`${step('publish')} && !document.getElementById('mx-pcolors-wrap').hidden && document.querySelectorAll('#mx-pcolors [data-pub-color]').length >= 3`, `${tag} colour chips`);
  ok(await ev("document.querySelector('#mx-pcolors [data-pub-color]:checked').disabled && document.querySelectorAll('#mx-pcolors [data-pub-color]:checked').length === 1"), `${tag}: the design's colour is in and fixed`);
  ok(await ev("document.getElementById('mx-pub-more') && !document.getElementById('mx-pub-more').open && document.getElementById('mx-pub-more-meta').textContent.length > 3"), `${tag}: More options closed with a summary`);
  const extra = await ev("[...document.querySelectorAll('#mx-pcolors [data-pub-color]:not(:checked)')].slice(0, 2).map(x => x.dataset.pubColor)");
  for (const n of extra) await click(`#mx-pcolors [data-pub-color="${n}"]`);
  ok(await ev(`MerchUI.state.colors.length === 3 && ${JSON.stringify(extra)}.every(n => MerchUI.state.colors.includes(n))`), `${tag}: two more colours ticked (${await ev('MerchUI.state.colors.join()')})`);
  await until("document.querySelectorAll('#mx-pvariants [data-pvar] canvas[data-drawn]').length === 3", `${tag} a preview per colour`);
  await click(`#mx-pvariants [data-pvar="${extra[0]}"]`);
  ok(await ev(`MerchUI.state.pubColor === ${JSON.stringify(extra[0])} && document.querySelector('#mx-pvariants [aria-checked=true]').dataset.pvar === ${JSON.stringify(extra[0])}`), `${tag}: pick a colour to preview it`);
  await until("!document.getElementById('mx-preview').hidden && !document.getElementById('mx-preview').disabled && !MerchUI.state.mock.busy", `${tag} update mockups button`, 15000);
  await click('#mx-preview');
  await until("document.querySelectorAll('#mx-mockups .mx-mockups__group').length === 3", `${tag} mockups by colour`, 15000);
  const pv = bodies.filter(b => b.mode === 'preview').pop();
  ok(pv && pv.colors?.length === 3, `${tag}: preview sends every colour`);
  await audit(`${tag}-colors`);
  // Ad before create: no link yet.
  await click('#mx-ad-open');
  await adFlow(`${tag}-publish`, { live: false });
  await click('#mx-ack');
  await until("!document.getElementById('mx-create-fw').disabled", `${tag} create enabled`);
  bodies.length = 0;
  await click('#mx-create-fw');
  await until("!document.getElementById('mx-live').hidden && document.querySelector('#mx-live img')", `${tag} multi-colour live`, 25000);
  const cb = bodies.find(b => b.mode === 'create');
  ok(cb && cb.colors?.length === 3 && cb.colors[0] === cb.color, `${tag}: create sends colors:[3] with the design colour first`);
  ok(await ev("MerchUI.state.product.colors.length === 3 && document.querySelectorAll('#mx-live .mx-mockups__group').length === 3"), `${tag}: live panel groups mockups by colour`);
  // ── New blanks.
  await click('#mx-steps [data-step=designs]');
  await ev(`(() => { const b = document.querySelectorAll('#mx-strip [data-pick]')[2]; b.click(); return true; })()`);
  await until("!document.getElementById('mx-to-setup').disabled", `${tag} continue 2`);
  await click('#mx-to-setup');
  await until(`${step('publish')} && document.querySelectorAll('#mx-blanks [data-tpl]').length === ${DEMO.TEMPLATES.length}`, `${tag} blanks`);
  ok(await ev("['longsleeve','crewneck','tank','youth','tote'].every(k => { const b = document.querySelector('#mx-blanks [data-kind=' + k + ']'); return b && b.querySelector('.mx-blank__name').textContent.trim().length > 3; })"), `${tag}: new blanks with labels`);
  await click('#mx-blanks [data-kind=tank]');
  await until("MerchUI.state.templateId === 'pro_xPL7YjOBRQWVL50Im8eKAA' && document.querySelector('#mx-logo option[value=inline]')", `${tag} tank`);
  ok(await ev("document.getElementById('mx-logo').value === 'inline' && !document.getElementById('mx-pcolors-wrap').hidden"), `${tag}: tank: ES logo inside the print, colour chips`);
  await click('#mx-blanks [data-kind=tote]');
  await until("MerchUI.state.templateId === 'pro_367'", `${tag} tote`);
  ok(await ev("MerchUI.state.colors[0] === 'Oyster' && document.querySelectorAll('#mx-pcolors [data-pub-color]').length === 2 && document.getElementById('mx-logo').value === 'inline'"), `${tag}: tote: Oyster by default, Black on offer, logo inside`);
  await audit(`${tag}-blanks`);
  if (width === 1440 && theme === 'light') { await toteCanvas(tag); await click('#mx-to-setup'); await until(step('publish'), `${tag} back to publish`); }
  // ── Your merch: an ad from a row.
  await click('#mx-tab-list');
  await until("document.querySelector('#mx-list [data-row=ad]')", `${tag} list ad button`);
  await click('#mx-list [data-row=ad]');
  await until(`${adOpen} && document.querySelectorAll('#mx-ad-frames canvas.is-drawn').length >= 1`, `${tag} row ad`, 20000);
  ok(await ev("!document.querySelector('[data-ad-opt=link]').disabled"), `${tag}: a row ad links to the product`);
  await ev("document.getElementById('mx-ad').close(); true");
}

try {
  await merch7(1440, 'light');
  await merch7(1440, 'dark');
  await merch7(1024, 'light');
  await brainstormFlow(1440, 'light', 'pro');
  await brainstormFlow(1440, 'dark', 'pro');
  await brainstormFlow(1024, 'light', 'basic');
  await brainstormStates(1440, 'light');
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
console.log(`merch ui: ${checks} checks passed (1440 light + dark Pro, 1024 light Basic; merch7 angles, Quick publish, colours, new blanks, ads; brainstorm room; Create, making, studio folds, pill colours, popover, Publish, live panel, list and states; 375 list)`);
