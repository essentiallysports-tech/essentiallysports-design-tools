// Reels Studio v4 regression (UI lane, 2026-11-28): the script is never rewritten.
//   A. The AI plan changes the person's words -> the page asks the server again
//      for its code plan (forceCode) and uses that; every scene has a module or media.
//   B. That second request fails -> the page builds the scenes itself: credits
//      are not spoken, the hook headline comes from the first line, and still
//      every scene has a module or media (nothing is a headline on empty paper).
// Real headless Chrome over CDP (scripts/_qa-chrome.mjs); every API is stubbed;
// the code plan is the server's own (netlify/functions/reel-maker.js, AI off).
// Run: node scripts/check-reels-script-safe.mjs   (skips if Chrome isn't installed)
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, findChrome, startServer, startChrome, sleep, FAKE_SESSION } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('reels script safe: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels script safe: skipped (needs Node with WebSocket)'); process.exit(0); }
const require = createRequire(import.meta.url);
const server_ = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;

const SCRIPT = "Aaron Rodgers' 2011 season still has no twin: 45 touchdowns, 6 interceptions, a 122.5 passer rating and a 15-1 record. Then the playoffs came. Green Bay lost at home to the Giants. Source: Pro Football Reference.";
const scenario = { second: 'code' };
const plans = [];
async function reelApi(body) {
  const mode = body.mode;
  if (mode === 'config') return { status: 200, body: { ok: true, ai: true, voice: { mode: 'off', ready: false, label: 'Captions only' }, music: { ready: false }, aiClips: { ready: false }, sceneMedia: { ready: true }, review: { ready: true } } };
  if (mode === 'trends') return { status: 200, body: { ok: true, items: [] } };
  if (mode === 'plan') {
    plans.push(body);
    if (!body.forceCode) {
      // The "AI" plan: right shape, words changed.
      const r = await server_.plan({ ...body }, { email: 'qa@essentiallysports.com' }, { off: true });
      const plan = JSON.parse(JSON.stringify(r.plan));
      plan.chapters[0].beats[0].vo = 'Rodgers was simply unstoppable that year.';
      return { status: 200, body: { ...r, plan, source: 'director', voMatchesScript: false } };
    }
    if (scenario.second === 'fail') return { status: 503, body: { ok: false, error: 'The planner is unavailable right now.' } };
    // The server's own forceCode path (no gates: forceCode alone makes it the $0 code plan).
    const r = await server_.plan({ ...body }, { email: 'qa@essentiallysports.com' }, {});
    return { status: 200, body: r };
  }
  if (mode === 'scene-media') return { status: 200, body: { ok: true, beats: [], cost: 0, judgeQueue: [], subjects: [], clipCount: 0, needsClips: true } };
  if (mode === 'critique') return { status: 200, body: { ok: true, pass: true, plan: body.plan, cost: 0 } };
  if (mode === 'review') return { status: 200, body: { ok: true, ready: true, issues: [], plan: body.plan } };
  return { status: 200, body: { ok: true, projects: [] } };
}
const api = async (req, url, body) => {
  if (url.pathname === '/api/reel-maker') return reelApi(body || {});
  if (url.pathname === '/api/ai-status') return { status: 200, body: { ok: true, mode: 'ai' } };
  if (url.pathname === '/api/es-image-search') return { status: 200, body: { results: [] } };
  return null;
};

const { server, base } = await startServer({ api });
const page = await startChrome(CHROME, { width: 1440, height: 900 });
const { send, evaluate } = page;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });
await send('Page.navigate', { url: `${base}/__blank` }); await sleep(400);
await evaluate(FAKE_SESSION);

const fails = [];
const expect = (ok, what) => { if (!ok) fails.push(what); };
async function make() {
  plans.length = 0;
  await evaluate(`(() => { try { for (const k of Object.keys(localStorage)) if (/reel/i.test(k)) localStorage.removeItem(k); sessionStorage.setItem('frameup.tours.offered', '1'); } catch {} return 1; })()`);
  await send('Page.navigate', { url: `${base}/reel-maker.html` });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await evaluate('Boolean(window.ReelMakerPage)').catch(() => false)) break; }
  await sleep(500);
  await evaluate(`(() => { const p = document.querySelector('#rm-prompt'); p.value = ${JSON.stringify(SCRIPT)}; p.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#rm-make').click(); return 1; })()`);
  for (let i = 0; i < 150; i++) { await sleep(200); if (await evaluate(`!document.querySelector('#rm-pane-edit').hidden`).catch(() => false)) break; }
  await sleep(800);
  return evaluate(`(() => { const s = window.ReelMakerCtx.state; const p = s.plan; const beats = p.chapters ? p.chapters.flatMap(c => c.beats) : p.beats; const bare = beats.filter(b => !(b.module && b.module.type) && !(b.media && b.media.kind && !['none', 'auto'].includes(b.media.kind)) && !(b.block && !['hook', 'statement'].includes(b.block.type))).map(b => b.id); return { source: s.planSource, v4: Array.isArray(p.chapters), vo: beats.map(b => b.vo).join(' '), bare, hook: p.chapters ? p.chapters[0].headline : '' }; })()`);
}
const loose = t => String(t || '').toLowerCase().replace(/[*]/g, '').replace(/source:[^.]*\.?/i, '').replace(/[^a-z0-9.\s'-]/g, ' ').replace(/[.]+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

// A. Changed words -> the server's code plan.
scenario.second = 'code';
const a = await make();
expect(plans.length === 2 && plans[1].forceCode === true, `A: the page did not ask again for the code plan (forceCode) after the AI changed the words (${plans.length} plan calls)`);
expect(a.source === 'code', `A: the page used "${a.source}", not the server's code plan`);
expect(loose(a.vo) === loose(SCRIPT), `A: the voiceover is not the script: "${a.vo}"`);
expect(!a.bare.length, `A: scenes with neither a module nor media: ${a.bare.join(', ')}`);

// B. The second request fails -> the page's own builder, still nothing bare.
scenario.second = 'fail';
const b = await make();
expect(b.source === 'script', `B: expected the page's own plan, got "${b.source}"`);
expect(loose(b.vo) === loose(SCRIPT) && !/source:/i.test(b.vo), `B: the voiceover is not the script (credits spoken?): "${b.vo}"`);
expect(!b.bare.length, `B: scenes with neither a module nor media: ${b.bare.join(', ')}`);
expect(/RODGERS/.test(b.hook) && /\*/.test(b.hook), `B: the hook headline does not come from the first line: "${b.hook}"`);

page.close(); server.close();
if (fails.length) { fails.forEach(f => console.log(`FAIL ${f}`)); console.log(`reels script safe: ${fails.length} problem(s)`); process.exit(1); }
console.log(`reels script safe: changed words -> server code plan; server down -> page plan; no bare scenes (hook "${b.hook}")`);
