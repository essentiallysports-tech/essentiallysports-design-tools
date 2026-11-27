// Reels Studio regression (UI lane, 2026-11-28): the page must load when the
// config reply is partial (no `voice` block: an old server, a proxy answering
// 200, a trimmed reply). It used to throw "reading 'ready'" in costEstimate and
// leave Create blank. Also checks the Create layout does not jump when the
// four style previews draw (the cards' height is reserved).
// Real headless Chrome over CDP (scripts/_qa-chrome.mjs); every API is stubbed.
// Run: node scripts/check-reels-config-guard.mjs   (skips if Chrome isn't installed)
import { findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('reels config guard: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels config guard: skipped (needs Node with WebSocket)'); process.exit(0); }

const REPLIES = {
  'no voice': { ok: true, ai: true },
  'voice null': { ok: true, ai: true, voice: null },
  'empty object': {},
};
let reply = REPLIES['no voice'];
const api = async (req, url, body) => {
  if (url.pathname === '/api/reel-maker') {
    if (body && body.mode === 'config') return { status: 200, body: reply };
    if (body && body.mode === 'trends') return { status: 200, body: { ok: true, items: [] } };
    return { status: 200, body: { ok: true, projects: [] } };
  }
  if (url.pathname === '/api/ai-status') return { status: 200, body: { ok: true, mode: 'ai' } };
  return null;
};

const { server, base } = await startServer({ api });
const page = await startChrome(CHROME, { width: 1440, height: 900 });
const { send, evaluate } = page;
const errors = [];
page.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });
await send('Page.navigate', { url: `${base}/__blank` }); await sleep(400);
await evaluate(FAKE_SESSION);

const fails = [];
for (const [name, body] of Object.entries(REPLIES)) {
  reply = body;
  errors.length = 0;
  await evaluate(`(() => { try { sessionStorage.setItem('frameup.tours.offered', '1'); } catch {} return 1; })()`);
  await send('Page.navigate', { url: `${base}/reel-maker.html` });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await sleep(200); ready = await evaluate('Boolean(window.ReelMakerPage && window.ReelMakerCtx)').catch(() => false); }
  await sleep(800);
  const r = await evaluate(`({ hint: (document.querySelector('#rm-make-hint')?.textContent || '').trim(), cards: document.querySelectorAll('#rm-styles4 [data-style4]').length, voice: JSON.stringify(window.ReelMakerCtx?.state.config.voice || null) })`).catch(e => ({ error: String(e) }));
  const bad = errors.filter(e => /ready|voice|config/i.test(e));
  if (!ready) fails.push(`${name}: the page did not start`);
  if (bad.length) fails.push(`${name}: ${bad[0]}`);
  if (!r.hint || r.cards !== 4) fails.push(`${name}: Create did not render (hint "${r.hint}", ${r.cards} style cards)`);
  if (!/"ready":false/.test(r.voice || '')) fails.push(`${name}: config.voice is not a captions-only default: ${r.voice}`);
}

// Layout shift: the style grid's reserved height (before the cards draw) matches the drawn cards.
reply = REPLIES['no voice'];
const sizes = [];
for (const w of [1440, 1024, 768]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/reel-maker.html` });
  for (let i = 0; i < 60; i++) { await sleep(150); if (await evaluate(`document.querySelectorAll('#rm-styles4 [data-style4]').length === 4`).catch(() => false)) break; }
  await sleep(600);
  const m = await evaluate(`(() => { const g = document.querySelector('#rm-styles4'); const top = g.getBoundingClientRect().top; const reserved = Math.round(parseFloat(getComputedStyle(g).minHeight) || 0); g.style.minHeight = '0px'; const real = Math.max(...[...g.children].map(k => k.getBoundingClientRect().bottom)) - g.getBoundingClientRect().top; g.style.minHeight = ''; return { reserved, real: Math.round(real) }; })()`);
  sizes.push(`${w}: ${m.reserved}/${m.real}`);
  if (m.real > m.reserved + 24) fails.push(`layout shift at ${w}: the cards need ${m.real} px but ${m.reserved} px are reserved`);
  if (m.reserved > m.real + 48) fails.push(`empty band at ${w}: ${m.reserved} px reserved for ${m.real} px of cards`);
}

page.close(); server.close();
console.log('sizes', sizes.join(', '));
if (fails.length) { fails.forEach(f => console.log(`FAIL ${f}`)); console.log(`reels config guard: ${fails.length} problem(s)`); process.exit(1); }
console.log(`reels config guard: the page loads with ${Object.keys(REPLIES).length} partial config replies; style cards reserved/real px ${sizes.join(', ')}`);
