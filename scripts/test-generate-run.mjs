// Generate Creative run() (live bug 2026-11-21): Creative showed its designs,
// then Generate switched to the old template flow ("Directions first", v1
// templates). Root cause: the server never sends plan.imagery, and
// addCutouts() set plan.imagery.cutoutCost whenever the page made cut-outs
// (every brief naming a person with an ES photo), so run() threw, its catch
// cleared the grid and returned 'fallback'.
// This drives the real generate-creative.js + frameup-compose.js +
// generate-focus.js in headless Chrome with a fake page API (window.FrameUpGenerate)
// and fake cut-outs, and asserts:
//   - a plan without `imagery` (the live shape) and with it both keep their designs;
//   - a failing preview, summary, research list, tracking or Gallery mark after
//     the designs are on screen never clears them or falls back;
//   - a failure before any design is made still falls back (templates), and a
//     limit reply stops with a notice, without being logged as an error;
//   - caught errors reach FrameUpErrors.report (Dashboard -> Errors).
// Run: node scripts/test-generate-run.mjs   (skips if Chrome isn't installed)
import assert from 'node:assert/strict';
import { findChrome, startServer, startChrome, sleep } from './_qa-chrome.mjs';
import { buildPlan, qaFile, proxiedPlan, qaProxyFile } from './_qa-generate-fixtures.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('generate run: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('generate run: skipped (needs Node with WebSocket)'); process.exit(0); }

const BRIEF = 'Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL';
const base = await buildPlan(BRIEF);
// Live shape: proxied ES photos, no cut-outs yet, and no plan.imagery.
const LIVE = proxiedPlan(base);
LIVE.directions.forEach(d => { if (d.input) { d.input.cutout = null; d.input.cutouts = []; } d.cutout = null; });
delete LIVE.imagery;
const WITH_IMAGERY = { ...JSON.parse(JSON.stringify(LIVE)), imagery: { cutoutPlan: [] } };

const PAGE = `<!doctype html><meta charset="utf-8"><title>run</title>
<form id="gen-form"><div id="gen-steer"></div><span id="gen-expect"></span><button id="gen-submit" type="submit">Generate</button></form>
<section id="gen-empty"></section><div id="gen-setbar" hidden></div><div id="gen-grid"></div><details id="gen-research" hidden></details>
<script>
  window.__log = { notices: [], reports: [], summary: '' };
  window.FrameUpErrors = { report: (error, ctx) => window.__log.reports.push((ctx && ctx.where) + ': ' + (error && error.message)) };
  window.__fail = {};
  const boom = what => { if (window.__fail[what]) throw new Error(what + ' failed'); };
  window.FrameUpPosted = { markGenerateRun: () => boom('posted') };
  window.FrameUpAssets = { prepareCutouts: async () => ({ cutouts: [], cost: 0.004, made: 0, failed: 1 }) };
  window.FrameUpGenerate = {
    els: { empty: document.getElementById('gen-empty'), research: document.getElementById('gen-research'), grid: document.getElementById('gen-grid'), submit: document.getElementById('gen-submit') },
    ICON: {}, esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    callApi: async (path, body) => {
      if (body.mode === 'creative') { if (window.__fail.plan) throw new Error(window.__fail.plan); return JSON.parse(JSON.stringify(window.__plan)); }
      if (body.mode === 'creative-judge') { if (window.__fail.preview) window.__breakPreview = true; return { directions: [], cost: 0, source: 'heuristic' }; }
      return {};
    },
    setBusy: v => { window.__busy = v; }, isBusy: () => Boolean(window.__busy),
    setNotice: (title, body) => { if (title) window.__log.notices.push(title + (body || '')); },
    setSummary: html => { boom('summary'); window.__log.summary = html; },
    startProgress: () => ({ stop: () => 1, designing: () => {} }),
    restoreFocus: () => {}, showResearch: () => boom('research'), rememberBrief: () => boom('remember'),
    track: () => boom('track'), steer: () => ({}), renderer: () => Promise.resolve(), rendererFrame: () => null,
  };
</script>
<script src="/frameup-compose.js"></script>
<script src="/generate-focus.js"></script>
<script src="/generate-creative.js"></script>
<script>
  // A preview that throws once the designs are on screen (after the judge).
  const real = window.FrameUpCompose.toDataUrl;
  window.FrameUpCompose.toDataUrl = (...a) => { if (window.__breakPreview) return Promise.reject(new Error('preview failed')); return real(...a); };
  window.__ready = true;
</script>`;

const { server, base: origin } = await startServer({
  extra: url => (url.pathname === '/__qa-run.html' ? { type: 'text/html', body: PAGE } : qaFile(url)),
  api: (req, url) => { if (url.pathname === '/api/es-image-search') { const f = qaProxyFile(url); return f ? { type: f.type, body: f.body } : { status: 404, body: {} }; } return null; },
});
const chrome = await startChrome(CHROME);
const { send, evaluate } = chrome;
let failed = false;
try {
  await send('Page.enable');
  const runCase = async (name, { plan = LIVE, fail = {} } = {}) => {
    await send('Page.navigate', { url: `${origin}/__qa-run.html` });
    for (let i = 0; i < 100 && !(await evaluate('window.__ready === true && Boolean(window.FrameUpCreative)').catch(() => false)); i++) await sleep(100);
    return evaluate(`(async () => {
      window.__plan = ${JSON.stringify(plan)};
      window.__fail = ${JSON.stringify(fail)};
      const result = await window.FrameUpCreative.run(${JSON.stringify(BRIEF)});
      return { result: result ?? null, cards: document.querySelectorAll('#gen-grid .gen-cc:not(.is-skeleton)').length, failedPreviews: document.querySelectorAll('#gen-grid .gen-cc.is-failed').length, ...window.__log };
    })()`);
  };

  // 1. The live plan shape (no plan.imagery) keeps its designs.
  let r = await runCase('live');
  assert.notEqual(r.result, 'fallback', 'a plan without imagery never falls back');
  assert.ok(r.cards >= 2, `designs stay on screen (${r.cards})`);
  assert.ok(!r.reports.some(x => /cutoutCost/.test(x)), `no plan.imagery error: ${r.reports.join(' | ')}`);
  assert.match(r.summary, /design/);

  // 2. With plan.imagery it works the same.
  r = await runCase('imagery', { plan: WITH_IMAGERY });
  assert.notEqual(r.result, 'fallback');
  assert.ok(r.cards >= 2);

  // 3. A preview that throws after render: designs stay (marked failed), no fallback.
  r = await runCase('preview', { fail: { preview: true } });
  assert.notEqual(r.result, 'fallback', 'a failing preview never falls back');
  assert.ok(r.cards >= 2, 'the designs stay');
  assert.equal(r.failedPreviews, r.cards, 'each card shows its preview failed');

  // 4. Everything after render failing: designs stay, errors reported, a calm notice.
  r = await runCase('after', { fail: { summary: true, research: true, track: true, posted: true, remember: true } });
  assert.notEqual(r.result, 'fallback', 'a failure after render never falls back');
  assert.ok(r.cards >= 2, 'the designs stay');
  assert.ok(r.reports.some(x => /^creative-(after-render|posted|remember|research)/.test(x)), `caught errors are reported: ${r.reports.join(' | ')}`);
  assert.ok(!r.notices.some(n => /ES templates/.test(n)));

  // 5. Before any design: a broken reply still falls back to ES templates…
  r = await runCase('before', { fail: { plan: 'Request failed (502).' } });
  assert.equal(r.result, 'fallback', 'no designs made: ES templates take over');
  assert.equal(r.cards, 0);
  assert.ok(r.reports.some(x => /^creative-run/.test(x)), 'and the failure is reported');
  // …a server timeout stops with a retry notice (never a silent template switch)…
  r = await runCase('timeout', { fail: { plan: 'Request failed (504).' } });
  assert.equal(r.result, 'stop', 'a 504 offers a retry instead of templates');
  assert.ok(r.notices.some(n => /took too long/.test(n)), `timeout notice: ${r.notices.join(' | ')}`);
  // …and a limit stops with a notice, not logged as an error.
  r = await runCase('limit', { fail: { plan: 'You have reached the hourly limit for Generate.' } });
  assert.equal(r.result, 'stop');
  assert.ok(r.notices.some(n => /Could not compose/.test(n)));
  assert.equal(r.reports.length, 0, `a limit is not an error: ${r.reports.join(' | ')}`);
  console.log('generate run: designs stay after render (live plan shape, imagery, failing preview / summary / research / tracking); fallback only before render; limits not logged');
} catch (error) {
  failed = true;
  console.error('generate run: FAIL', error.message);
} finally {
  chrome.close();
  server.close();
}
process.exit(failed ? 1 : 0);
