// Reels Studio v4 UI sweep (QA lane, 2026-11-27). Real headless Chrome over
// CDP (scripts/_qa-chrome.mjs: Node's built-in WebSocket, no npm deps). A local
// static server serves the repo; /api/* is stubbed, never the network or AI:
//   plan        a plan v4 from scripts/fixtures/reels4/reference-plans.json for
//               the picked style (Breakdown = Dallas, Case File = Rodgers, The
//               Outlier = Kittle, Hot Seat = Ravens), cut to 2 chapters when the
//               length is Short; script mode and free / offline use the server's
//               own code plan (AI off), as v3 did;
//   scene-media per beat media in the v4 sourcing shape (kind, motionOk, judged
//               segment) plus clipCount / needsClips; scenario.clips = 'none'
//               answers with no clip anywhere until a "Find clips" request;
//   critique    the critic (pass, or a fail with fixes);
//   revise      Ask AI (a changed hook);
//   feedback    ReelFeedback.log events, recorded (the client is also wrapped).
//
// The journey (contract: scratchpad reels4-contract.md, UI):
//   Create   one prompt (#rm-prompt), 4 style cards (#rm-styles4: Breakdown,
//            Case File, The Outlier, Hot Seat, each with a live preview and one
//            line), the length toggle (#rm-length: Full ~90 s / Short ~40 s,
//            sent with the plan request), Make my reel (#rm-make), "Start from
//            a trend", "Need an idea?" and no old Start UI.
//   Review   the chapter strip (#rm-scenes: [data-chapter] groups of
//            [data-beat] cards, each with a media thumbnail, its module type and
//            its words) with Swap media / Edit / Change module / Ask AI; the
//            "Ready to post" badge (#rm-ready) that needs the motion rule, >= 1
//            clip and a critic pass (the critique call comes first); with no
//            clips it is not ready and offers "Find clips", which sources clips
//            and then lets it pass; a failing critic keeps it from passing.
//   Export   one Export button plus "Also export", Organic / Paid, rights.
//   Learning every Swap / Edit / Change module / Ask AI / export logs a feedback
//            event (swap_media, edit_text, change_module, regenerate, export)
//            with the reel, beat or chapter ids and the style.
// Every state is audited in light and dark (scripts/lib/reels-ui-audit.js).
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
const STYLE_IDS = ['breakdown', 'casefile', 'outlier', 'hotseat'];
const STYLE_LABELS = ['Breakdown', 'Case File', 'The Outlier', 'Hot Seat'];
const LEGACY_IDS = ['gametape', 'statcard', 'receipts', 'hypecut'];

// ─── Fixtures ────────────────────────────────────────────────────────────────
const server_ = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels4/reference-plans.json'), 'utf8'));
const PLAN_FOR = { breakdown: 'dallas-21-point-lead', casefile: 'rodgers-who-should-call', outlier: 'kittle-outlier', hotseat: 'ravens-perfect-cover' };
const clone = o => JSON.parse(JSON.stringify(o));
const allBeats = plan => (plan && Array.isArray(plan.chapters) ? plan.chapters.flatMap(c => (c.beats || []).map(b => ({ ...b, chapterId: c.id }))) : (plan?.beats || []));
// v4 is script-first: the reference structure, with the person's script spread over the beats in
// order, word for word (sentences in contiguous runs; beats past the last sentence are dropped).
function fixturePlan(style, length, script = '') {
  const ref = REF.plans.find(p => p.id === PLAN_FOR[style]) || REF.plans[0];
  const plan = clone(ref.plan);
  plan.esStyle = style; plan.style = 'es';
  if (length === 'short') { plan.chapters = plan.chapters.slice(0, 2); plan.length = 'short'; } else plan.length = 'full';
  const text = String(script || '').replace(/\s+/g, ' ').trim();
  if (text) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map(x => x.trim()).filter(Boolean);
    const beats = plan.chapters.flatMap(c => c.beats);
    const n = Math.min(beats.length, sentences.length);
    const keep = new Set(beats.slice(0, n).map(b => b.id));
    beats.slice(0, n).forEach((b, i) => { const a = Math.floor(i * sentences.length / n), z = Math.floor((i + 1) * sentences.length / n); b.vo = sentences.slice(a, z).join(' '); });
    plan.chapters = plan.chapters.map(c => ({ ...c, beats: c.beats.filter(b => keep.has(b.id)) })).filter(c => c.beats.length);
    plan.script = text;
  }
  return plan;
}
const lengthOf = body => {
  const v = body.length ?? body.reelLength ?? body.duration ?? body.targetSec ?? body.plan?.length;
  if (v === 'short' || body.short === true || (Number(v) > 0 && Number(v) <= 60)) return 'short';
  if (v === 'full' || Number(v) > 60) return 'full';
  return '';
};

const now = Date.now();
const TRENDS = {
  ok: true, hours: 48, stale: false, updatedAt: new Date(now).toISOString(),
  items: [
    { id: 't1', sport: 'nfl', title: 'Cowboys blow a 21-point lead and lose to the Eagles on a 59-yard field goal', source: 'ESPN', url: 'https://example.com/a', publishedAt: new Date(now - 3600e3).toISOString(), team: 'Dallas Cowboys', format: 'explainer', related: [{ title: 'The fourth-and-1 call everyone is talking about', url: 'https://example.com/b', source: 'NFL' }] },
    { id: 't2', sport: 'nba', title: 'Victor Wembanyama has 5+ blocks in 9 straight games', source: 'NBA', url: 'https://example.com/c', publishedAt: new Date(now - 7200e3).toISOString(), team: 'San Antonio Spurs', format: 'stat', related: [] },
    { id: 't3', sport: 'wnba', title: 'Caitlin Clark sets the single-season assist record', source: 'WNBA', url: 'https://example.com/d', publishedAt: new Date(now - 10800e3).toISOString(), team: 'Indiana Fever', format: 'stat', related: [] },
    { id: 't4', sport: 'golf', title: 'Scottie Scheffler wins the Masters by four', source: 'PGA Tour', url: 'https://example.com/e', publishedAt: new Date(now - 14400e3).toISOString(), team: '', format: 'stat', related: [] },
  ],
};
const CLIP = { url: 'https://x.com/NFL/status/1855000000000000001', handle: 'NFL', text: 'Cowboys 4th and 1', thumb: '/design-request-hero.webp', postedAt: new Date(now - 3600e3).toISOString(), durationMs: 8000, variants: [{ url: '/design-request-banner.webm', width: 1280, height: 720 }] };
const PHOTOS = ['/how-step-choose.webp', '/how-step-content.webp', '/how-step-export.webp', '/how-step-format.webp', '/how-step-review.webp', '/login-artwork.webp'];
// v4 is script-first: the prompt is the voiceover script (the Dallas reference reel's words).
const BRIEF = REF.plans.find(p => p.id === 'dallas-21-point-lead').plan.script;

// ─── Stubbed API ─────────────────────────────────────────────────────────────
const scenario = { trends: 'ok', config: 'ok', slow: 0, planDelay: 0, planFrom: 'fixture', clips: 'ok', critic: 'pass', motion: 'ok' };
const calls = []; // { path, mode, body } for every /api call
const findClipCalls = [];
const isFind = (pathname, body) => /find/i.test(String(body?.mode || '')) || body?.findClips === true || body?.retry === true || Boolean(body?.broaden) || (pathname === '/api/video-ads' && /find|search|clips/i.test(String(body?.mode || '')));
const v4Style = body => body.esStyle || (STYLE_IDS.includes(body.style) ? body.style : '') || body.plan?.esStyle || 'breakdown';
// Clips come from the confirmed-clip library (clip.confirmed { relevance, moment, kind }): the browser gate
// (reel-clips gatedPicks) passes them without the judge, as the SOURCING lane's library does.
function sceneMedia(body) {
  const style = v4Style(body);
  if (scenario.clips === 'none-once') { scenario.clips = 'none'; scenario.flipNext = true; } else if (scenario.flipNext) { scenario.clips = 'ok'; scenario.flipNext = false; }
  const clipsOn = scenario.clips === 'ok';
  const beats = allBeats(body.plan || {}).filter(b => !(b.kind === 'cta' || b.block?.type === 'endcard'));
  let clipCount = 0;
  const staticAt = beats.findIndex(b => !b.media || b.media.kind === 'none');
  const out = beats.map((b, i) => {
    const wants = b.media?.kind || (b.module ? 'none' : 'clip');
    const subject = b.media?.subject || { type: 'player', name: 'Dak Prescott', team: 'Dallas Cowboys' };
    const videoKind = ['clip', 'presser'].includes(wants);
    const clips = videoKind && clipsOn ? [0, 1].map(k => ({ ...CLIP, url: `${CLIP.url.slice(0, -1)}${i}${k}`, text: `${subject.name} clip ${k + 1} for beat ${b.id}`, relevance: 9 - k, moment: 8 - k, judged: true, confirmed: { relevance: 9 - k, moment: 8 - k, kind: wants, at: new Date(now).toISOString() }, gate: 'library', score: 90 - k, kind: wants, segment: { start: 0.4, end: 4.4 } })) : [];
    const photos = wants === 'none' ? [] : [0, 1, 2].map(k => ({ url: PHOTOS[(i + k) % PHOTOS.length], sourceUrl: `https://www.essentiallysports.com/photo-${i}-${k}`, verified: true, focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.3 }, head: { x: 0.5, y: 0.22 }, kind: 'photo', title: `Photo ${k + 1}`, credit: 'ES', rights: { source: 'ES', licence: 'ES image pool', organic: true, paid: false } }));
    let pick;
    if (wants === 'none') pick = { kind: 'none', ref: '', why: 'module beat' };
    else if (clips.length) { pick = { kind: 'clip', ref: clips[0].url, segment: { inSec: 0.4, outSec: 4.4 }, why: 'qa' }; clipCount++; } else pick = { kind: 'photo', ref: photos[0].url, kenBurns: true, why: 'no clip: verified photo with Ken Burns' };
    return { motion: wants === 'none' ? 'module' : (clips.length ? 'clip' : 'kenburns'), failures: [], ladder: [{ rung: 'player+moment', n: clips.length, cost: 0, ms: 5 }], beatId: b.id, chapterId: b.chapterId, block: b.block || null, module: b.module || null, kind: wants, wants, subject: { ...subject, key: String(subject.name || '').toLowerCase() }, clips, photos, pick, motionOk: !(scenario.motion === 'static' && i === staticAt), ...(scenario.motion === 'static' && i === staticAt ? { motionWhy: 'a still photo with no Ken Burns and no module' } : {}), segment: clips[0]?.segment || null };
  });
  return {
    ok: true, esStyle: style, cost: 0, costs: { clips: 0, photos: 0 }, capped: { clips: false, photos: false },
    judge: { ready: true, maxClips: 24, perCall: 4, maxUsdPerReel: 0.03, threshold: { relevance: 7, moment: 5 } },
    judgeQueue: [], subjects: [{ key: 'dak prescott', label: 'Dak Prescott', moment: '4th and 1' }],
    beats: out, clipCount, needsClips: clipCount === 0, motionOk: scenario.motion !== 'static',
    v: 4, stats: { clips: clipCount }, ms: 5,
    actions: clipCount === 0 ? [{ action: 'find-clips', id: 'find-clips', beatIds: out.filter(x => ['clip', 'presser'].includes(x.kind)).map(x => x.beatId), label: 'Find clips' }] : [],
  };
}

const feedback = []; // every feedback event from the network
async function reelApi(pathname, body) {
  const free = scenario.config === 'free';
  const mode = body.mode;
  calls.push({ path: pathname, mode, body });
  if (scenario.config === 'offline') return { status: 404, body: '', type: 'text/plain' };
  if (isFind(pathname, body)) { findClipCalls.push({ path: pathname, mode, body }); scenario.clips = 'ok'; }
  if (mode === 'feedback' || pathname === '/api/reel-feedback') { (Array.isArray(body.events) ? body.events : [body]).forEach(e => feedback.push({ via: 'net', ...e })); return { status: 200, body: { ok: true } }; }
  if (mode === 'config') return { status: 200, body: { ok: true, ai: !free, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'Voice is not set up here.' }, music: { ready: false }, formats: [], dataFormats: [], formatModes: {}, aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: true }, sceneMedia: { ready: true }, review: { ready: true }, critique: { ready: true }, feedback: { ready: true } } };
  if (mode === 'trends') {
    if (scenario.slow) await sleep(scenario.slow);
    if (scenario.trends === 'error') return { status: 502, body: { ok: false, error: 'Trends are unavailable right now.' } };
    if (scenario.trends === 'empty') return { status: 200, body: { ...TRENDS, items: [] } };
    return { status: 200, body: TRENDS };
  }
  if (mode === 'plan') {
    if (scenario.planDelay) await sleep(scenario.planDelay);
    // v4 is script-first (AI lane): a v4 plan request needs the script (>= 6 words), word for word.
    const v4Req = body.v === 4 || STYLE_IDS.includes(String(body.esStyle || ''));
    if (v4Req && !free && String(body.script || '').trim().split(/\s+/).filter(Boolean).length < 6) return { status: 400, body: { ok: false, reason: 'need-script', error: 'Paste or write your script first: a sentence or two at least. It is read word for word.' } };
    if (scenario.planFrom === 'fixture' && !free) {
      const style = STYLE_IDS.includes(body.esStyle) ? body.esStyle : 'breakdown';
      const plan = fixturePlan(style, lengthOf(body) || 'full', body.script);
      return { status: 200, body: { ok: true, plan, source: 'ai', model: 'qa', esStyle: style, style: 'es', sources: plan.sources, corpus: BRIEF, issues: [], lint: { critical: 0, warnings: 0 }, costs: {}, cost: 0 } };
    }
    const r = await server_.plan(body, { email: 'qa@essentiallysports.com' }, free ? { free: true } : { off: true });
    if (r.plan && body.esStyle && !r.plan.esStyle) r.plan.esStyle = body.esStyle;
    if (r.plan && !r.plan.sourceLine && /Source: ([^.]+)/.test(body.brief || '')) r.plan.sourceLine = `Source: ${body.brief.match(/Source: ([^.]+)/)[1]}`;
    return { status: r.ok ? 200 : (r.status || 502), body: free ? { ...r, mode: 'free', reason: 'user-limit' } : r };
  }
  if (mode === 'scene-media' || (mode && /media|clips/i.test(mode) && pathname === '/api/reel-maker')) { if (scenario.planDelay) await sleep(scenario.planDelay / 2); return { status: 200, body: sceneMedia(body) }; }
  // SOURCING lane modes: clip-rank (kept / swapped clips) and clip-proxy (video bytes, the CORS fallback).
  if (mode === 'clip-rank') return { status: 200, body: { ok: true, rank: body.delta || 0 } };
  // The mocked clips are same-origin (no CORS failure), so the proxy should not be needed; it is recorded if it is.
  if (mode === 'clip-proxy') return { status: 206, type: 'video/webm', body: '' };
  if (mode === 'critique' && scenario.critic === 'error') return { status: 502, body: { ok: false, error: 'The critic is unavailable right now.' } };
  if (mode === 'script-draft') return { status: 200, body: { ok: true, script: BRIEF.replace(/ Source:.*$/, ''), cost: 0 } };
  if (mode === 'critique') {
    const pass = scenario.critic === 'pass';
    return { status: 200, body: { ok: true, pass, ready: pass, scores: { hook: pass ? 8 : 4, oneIdea: 8, mediaWords: 8, moduleClaim: 8, pacing: pass ? 8 : 5, close: 8 }, fixes: pass ? [] : [{ id: 'hook', chapterId: 'c1', text: 'The hook does not say the contradiction. Lead with the 21-point lead.', safe: false }], plan: body.plan, cost: 0, model: 'qa' } };
  }
  if (mode === 'review') return { status: 200, body: { ok: true, ready: true, issues: [], plan: body.plan, cost: 0, model: 'qa' } };
  if (mode === 'revise') {
    if (free) return { status: 200, body: { ok: true, skipped: true } };
    const plan = clone(body.plan || {});
    if (Array.isArray(plan.chapters) && plan.chapters[0]) {
      // Script-first: Ask AI may change what is on screen (headline, modules), never the voiceover words.
      plan.chapters[0].headline = 'DALLAS LED BY *21*';
    } else if (plan.beats?.[0]) { plan.beats[0].text = 'DALLAS LED BY 21'; plan.beats[0].vo = 'Dallas led by 21. They lost anyway.'; }
    return { status: 200, body: { ok: true, plan, cost: 0.001 } };
  }
  if (['event', 'project-save', 'projects'].includes(mode)) return { status: 200, body: { ok: true, cloud: false, projects: [] } };
  return { status: 503, body: { ok: false, reason: 'off', error: 'AI is not available right now.' } };
}
async function api(req, url, body) {
  if (url.pathname === '/api/reel-maker' || url.pathname === '/api/reel-feedback') return reelApi(url.pathname, body || {});
  if (url.pathname === '/api/video-ads') {
    calls.push({ path: url.pathname, mode: body?.mode, body });
    if (isFind(url.pathname, body)) { findClipCalls.push({ path: url.pathname, mode: body?.mode, body }); scenario.clips = 'ok'; }
    if (body?.mode === 'library') return { status: 200, body: { ok: true, clips: [CLIP] } };
    if (body?.mode === 'clip') return { status: 200, body: { ok: true, ...CLIP, url: body.url, thumbnail: CLIP.thumb } };
    return { status: 200, body: { ok: true, clips: scenario.clips === 'ok' ? [CLIP] : [], cost: 0 } };
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
// Never write to production Supabase with the fake session (usage tracker, spend meter, feedback table).
await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/rest/v1/*'] });
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
async function setViewport(w) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 812 : 1000, deviceScaleFactor: 1, mobile: w < 768 }); }
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
await evaluate(FAKE_SESSION);

// The client feedback hook: wrap ReelFeedback.log (fire-and-forget) so every event is seen even
// when it is batched or sent with sendBeacon. Events land in window.__qaFeedback.
const FEEDBACK_HOOK = `(() => { window.__qaFeedback = window.__qaFeedback || []; const wrap = () => { const F = window.ReelFeedback; if (!F || typeof F.log !== 'function' || F.log.__qa) return false; const orig = F.log; F.log = function (evt) { try { window.__qaFeedback.push(JSON.parse(JSON.stringify(evt || {}))); } catch { window.__qaFeedback.push({ event: String(evt && evt.event) }); } return orig.apply(this, arguments); }; F.log.__qa = true; return true; }; const wrapX = () => { const T = window.FrameUpTrack; if (!T || typeof T.exported !== 'function' || T.exported.__qa) return false; const o = T.exported; window.__qaExported = window.__qaExported || []; const ex = function (d) { try { window.__qaExported.push(JSON.parse(JSON.stringify(d || {}))); } catch {} return o.apply(T, arguments); }; ex.__qa = true; window.FrameUpTrack = Object.assign({}, T, { exported: ex }); return true; }; /* FrameUpTrack is frozen: the page gets a copy with exported() wrapped */ wrapX(); setTimeout(wrapX, 1500); if (!wrap()) { let n = 0; const t = setInterval(() => { if (wrap() || ++n > 100) clearInterval(t); }, 100); } return 1; })()`;
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
  await evaluate(FEEDBACK_HOOK);
  await sleep(600);
  consoleErrors = [];
  calls.length = 0; findClipCalls.length = 0; feedback.length = 0;
}
// Every feedback event so far (wrapped client + network).
async function feedbackEvents() {
  const client = (await evaluate('window.__qaFeedback || []').catch(() => [])) || [];
  return [...client.map(e => ({ via: 'client', ...e })), ...feedback];
}
const evName = e => String(e.event || e.type || e.kind || '');
async function expectFeedback(name, what) {
  const t0 = Date.now();
  let evs = [];
  while (Date.now() - t0 < 3000) { evs = await feedbackEvents(); if (evs.some(e => evName(e) === name)) break; await sleep(150); }
  let hit = evs.find(e => evName(e) === name);
  // What is actually sent: ReelFeedback normalises the event; check that copy when it exposes its queue or it went over the wire.
  const sent = feedback.find(e => evName(e) === name) || (await evaluate(`(window.ReelFeedback && window.ReelFeedback._queue || []).slice()`).catch(() => [])).find(e => evName(e) === name);
  if (hit && sent) hit = { ...sent, via: 'sent' };
  if (!hit) throw new Error(`${what}: no "${name}" feedback event (got ${[...new Set(evs.map(evName))].join(', ') || 'none'}; window.ReelFeedback is ${await evaluate('typeof window.ReelFeedback')})`);
  const bad = [];
  if (!(hit.reelId || hit.reel_id)) bad.push('reel id');
  if (['swap_media', 'edit_text', 'change_module', 'delete_beat'].includes(name) && !(hit.beatId || hit.beat_id || hit.chapterId || hit.chapter_id)) bad.push('beat / chapter id');
  if (!(hit.style || hit.esStyle)) bad.push('style');
  if (['swap_media', 'edit_text', 'change_module'].includes(name) && !('before' in hit || 'after' in hit)) bad.push('before / after');
  if (bad.length) throw new Error(`${what}: the "${name}" event has no ${bad.join(', ')}: ${JSON.stringify(hit).slice(0, 240)}`);
  const big = JSON.stringify({ before: hit.before, after: hit.after }).length;
  if (big > 4000) throw new Error(`${what}: before/after is ${big} bytes (contract: small JSON)`);
  return hit;
}

// ─── Audit ──────────────────────────────────────────────────────────────────
const AUDIT = fs.readFileSync(path.join(ROOT, 'scripts/lib/reels-ui-audit.js'), 'utf8');
const IGNORE = ['.rm-canvas', '.es-skeleton', '.es-sr-only', '[data-style-preview]', '[data-beat-thumb]'];
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
const typeInto = (sel, text) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); if ('value' in e) e.value = ${JSON.stringify(text)}; else e.textContent = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
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
// The plan's beats in the page, flat, with their chapter id (v4 chapters, or a v3 plan's beats).
const PAGE_BEATS = `(p => (p && Array.isArray(p.chapters) ? p.chapters.flatMap(c => (c.beats || []).map(b => Object.assign({ chapterId: c.id }, b))) : (p && p.beats) || []))`;
const STYLE_CARDS = `[...document.querySelectorAll('#rm-styles4 [role="radio"]')]`;
const pickStyle = id => evaluate(`(() => { const b = ${STYLE_CARDS}.find(x => (x.dataset.style4 || x.dataset.style) === ${JSON.stringify(id)}); if (!b) return false; b.click(); return true; })()`).then(async ok => { if (!ok) return false; await sleep(60); return evaluate(`${STYLE_CARDS}.some(x => (x.dataset.style4 || x.dataset.style) === ${JSON.stringify(id)} && x.getAttribute('aria-checked') === 'true')`); });
// The length toggle: #rm-length with [data-length] options (radios or buttons); falls back to any
// [data-length] control on Create.
const LENGTH_OPTS = `(() => { const host = document.querySelector('#rm-length'); const inHost = host ? [...host.querySelectorAll('[data-length], [role="radio"], input[type="radio"]')] : []; const any = inHost.length ? inHost : [...document.querySelectorAll('#rm-pane-topic [data-length]')]; return any.filter(e => ${SHOWN}(e) || (e.type === 'radio' && ${SHOWN}(e.closest('label') || e.parentElement))); })()`;
const lengthId = `(e => { const t = e.textContent + ' ' + (e.getAttribute('aria-label') || '') + ' ' + ((e.closest('label') || {}).textContent || ''); return e.dataset.length || (e.value && e.value !== 'on' ? e.value : '') || (/short/i.test(t) ? 'short' : /full/i.test(t) ? 'full' : ''); })`;
const pickLength = id => evaluate(`(() => { const o = ${LENGTH_OPTS}.find(e => ${lengthId}(e) === ${JSON.stringify(id)}); if (!o) return false; o.click(); return true; })()`);
const inReview = `${SHOWN}(document.querySelector('#rm-pane-edit')) && !document.querySelector('#rm-pane-edit').hidden`;
async function makeReel({ style = 'breakdown', text = BRIEF, script = false, length = '' } = {}) {
  await pickStyle(style);
  if (length) await pickLength(length);
  if (await evaluate(`Boolean(document.querySelector('#rm-script-mode'))`)) await evaluate(`(() => { const s = document.querySelector('#rm-script-mode'); if (s.checked !== ${script}) s.click(); return 1; })()`);
  await typeInto('#rm-prompt', text);
  // The sources field (script-first Create): the reference reel's sourced claims, so the number lint has them.
  if (await evaluate(`Boolean(document.querySelector('#rm-topic'))`)) await typeInto('#rm-topic', (REF.plans.find(p => p.id === PLAN_FOR[style]) || REF.plans[0]).plan.sources.map(x => `${x.source}: ${x.claim}`).join('\n'));
  await must('#rm-make', 'Make my reel');
  await waitFor(inReview, 40000, 'the Review step');
}
// The chapter strip.
const CHAPTERS = `[...document.querySelectorAll('#rm-scenes [data-chapter], #rm-scenes [data-chap]')].filter(e => ${SHOWN}(e))`;
const BEAT_CARDS = `[...document.querySelectorAll('#rm-scenes [data-beat]')].filter(e => ${SHOWN}(e))`;
const beatCardExpr = idExpr => `document.querySelector('#rm-scenes [data-beat="' + ${idExpr} + '"]')`;
const beatCard = id => beatCardExpr(JSON.stringify(id));
// A control by what it says (text or aria-label), inside the beat card, the scene editor or an open dialog.
const ACTION = (re, beatId) => `(() => { const roots = [${beatId ? beatCard(beatId) : 'null'}, document.querySelector('#rm-scene-edit'), document.querySelector('#rm-beat-edit'), document.querySelector('dialog[open]'), document.querySelector('#rm-scenes')].filter(Boolean); for (const r of roots) { const b = [...r.querySelectorAll('button, [role="button"], [role="menuitem"], a[href]')].find(x => ${re}.test((x.textContent + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.title || '')).replace(/\\s+/g, ' ')) && ${SHOWN}(x)); if (b) return b; } return null; })()`;
const clickAction = async (re, beatId, what) => { const ok = await evaluate(`(() => { const b = ${ACTION(re, beatId)}; if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`); if (!ok) throw new Error(`${what}: no control matching ${re} on the beat or in its editor`); };
const selectBeat = id => evaluate(`(() => { const c = ${beatCard(id)}; if (!c) return false; c.scrollIntoView({ block: 'center' }); (c.querySelector('[data-beat-select]') || c).click(); return true; })()`);
// The words fields of the scene editor.
const FIELDS = id => `[...document.querySelectorAll('#rm-scene-edit textarea, #rm-scene-edit input[type="text"], #rm-beat-edit textarea, #rm-beat-edit input[type="text"], dialog[open] textarea, [data-edit-vo], [data-field="vo"], [contenteditable="true"]'), ...(${beatCard(id)} ? ${beatCard(id)}.querySelectorAll('textarea, input[type="text"]') : [])].filter(e => ${SHOWN}(e))`;
// The old v3 / 2.0 UI must be gone.
const OLD_UI = ['#rm-fmt-entry', '#rm-recipes', '#rm-recipe-sec', '#rm-looks', '#rm-styles', '#rm-styles-edit', '#rm-style-fold', '#rm-settings', '#rm-costs', '#rm-more', '#rm-export-all', '#rm-versions', '#rm-statusline', '#rm-source'];
const oldShown = () => evaluate(`${JSON.stringify(OLD_UI)}.filter(s => ${SHOWN}(document.querySelector(s)))`);
const readyText = () => evaluate(`(document.querySelector('#rm-ready')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
const checklistText = () => evaluate(`[...document.querySelectorAll('#rm-checklist li, #rm-issues li, #rm-lint li')].map(l => l.textContent.replace(/\\s+/g, ' ').trim()).join(' / ')`);
const READY_RE = /^\s*ready to post\b/i;
const FIND_CLIPS = `[...document.querySelectorAll('#main button, #main a')].filter(b => /find clips/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '')) && ${SHOWN}(b))`;

// ─── The sweep ──────────────────────────────────────────────────────────────
const t0 = Date.now();
for (const w of WIDTHS) {
  const first = w === WIDTHS[0];
  await setViewport(w);
  Object.assign(scenario, { trends: 'ok', config: 'ok', slow: 4000, planDelay: 0, planFrom: 'fixture', clips: 'ok', critic: 'pass' });
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
    expect(/(make|build) my reel/i.test(await evaluate(`document.querySelector('#rm-make').textContent`)), 'the button does not say Make / Build my reel');
    expect(await evaluate(`document.querySelector('#rm-make').matches('.es-btn--primary')`), 'Make my reel is not the primary button');
  });
  await step('Create: four v4 style cards (Breakdown, Case File, The Outlier, Hot Seat) with a preview and one line', async () => {
    const cards = await evaluate(`${STYLE_CARDS}.map(b => ({ id: b.dataset.style4 || b.dataset.style, text: b.textContent.replace(/\\s+/g, ' ').trim(), preview: Boolean(b.querySelector('canvas, video, img')), checked: b.getAttribute('aria-checked'), shown: ${SHOWN}(b) }))`);
    expect(cards.length === 4, `${cards.length} style cards`);
    expect(cards.map(c => c.id).join() === STYLE_IDS.join(), `style ids: ${cards.map(c => c.id).join()} (want ${STYLE_IDS.join()})`);
    expect(!cards.some(c => LEGACY_IDS.includes(c.id)), 'a retired v3 style is still offered');
    cards.forEach((c, i) => {
      expect(c.text.includes(STYLE_LABELS[i]), `card ${c.id} does not say "${STYLE_LABELS[i]}": ${c.text}`);
      expect(c.text.length > STYLE_LABELS[i].length + 8, `card ${c.id} has no one-line description`);
      expect(c.preview, `card ${c.id} has no preview (canvas / video / img)`);
      expect(c.shown, `card ${c.id} is not shown`);
    });
    expect(cards.filter(c => c.checked === 'true').length === 1, 'exactly one style should be picked');
  });
  await step('Create: the style previews are live (engine previewPlan) and not blank', async () => {
    const has = await evaluate(`(() => { const S = (window.ReelES && window.ReelES.STYLES) || {}; return ${JSON.stringify(STYLE_IDS)}.every(id => S[id] && S[id].previewPlan && S[id].previewPlan.v === 4) || typeof (window.ReelES && window.ReelES.previewPlan) === 'function'; })()`);
    expect(has, 'the styles have no v4 previewPlan (ReelES.STYLES[id].previewPlan; contract: the cards preview with the engine previewPlan)');
    const blank = await evaluate(`${STYLE_CARDS}.map(b => b.querySelector('canvas')).filter(Boolean).filter(c => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] + d[i + 1] + d[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo < 30; } catch { return false; } }).length`);
    expect(!blank, `${blank} style preview canvas(es) are blank`);
  });
  await step('Create: picking a style updates the expectation hint', async () => {
    for (let i = 0; i < 4; i++) {
      expect(await pickStyle(STYLE_IDS[i]), `${STYLE_IDS[i]} did not get picked`);
      await sleep(80);
      const hint = await evaluate(`document.querySelector('#rm-make-hint')?.textContent || ''`);
      expect(hint.includes(STYLE_LABELS[i]), `hint does not name ${STYLE_LABELS[i]}: "${hint}"`);
      const lenText = hint + ' ' + await evaluate(`(document.querySelector('#rm-meter-target')?.textContent || '') + ' ' + (document.querySelector('#rm-length [aria-checked="true"]')?.textContent || '')`);
      expect(/\d+\s?(s|sec|seconds)\b/i.test(lenText), `no length shown with the style (hint, meter target or length toggle): "${lenText}"`);
    }
  });
  await step('Create: the style cards are one radio group (arrow keys move the pick)', async () => {
    await pickStyle('breakdown');
    await evaluate(`(${STYLE_CARDS}[0].focus(), 1)`);
    await press('ArrowRight');
    const r = await evaluate(`({ on: (x => x && (x.dataset.style4 || x.dataset.style))(${STYLE_CARDS}.find(b => b.getAttribute('aria-checked') === 'true')), focus: document.activeElement?.dataset?.style4 || document.activeElement?.dataset?.style, tabs: ${STYLE_CARDS}.map(b => b.tabIndex) })`);
    expect(r.on === 'casefile' && r.focus === 'casefile', `after ArrowRight: picked ${r.on}, focus ${r.focus}`);
    expect(r.tabs.filter(t => t === 0).length === 1, `roving tabindex: ${r.tabs}`);
  });
  await step('Create: the length toggle (Full ~90 s / Short ~40 s), Full by default', async () => {
    const opts = await evaluate(`${LENGTH_OPTS}.map(e => ({ id: ${lengthId}(e), text: ((e.closest('label') || e).textContent || '').replace(/\\s+/g, ' ').trim(), on: e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-pressed') === 'true' || e.checked === true }))`);
    expect(opts.length === 2, `length options: ${JSON.stringify(opts)} (want #rm-length with Full and Short)`);
    expect(opts.map(o => o.id).sort().join() === 'full,short', `length ids: ${opts.map(o => o.id).join()}`);
    const on = opts.filter(o => o.on);
    expect(on.length === 1 && on[0].id === 'full', `picked: ${on.map(o => o.id).join() || 'none'} (Full should be the default)`);
    expect(/\b(8\d|9\d|100)\b/.test(opts.find(o => o.id === 'full').text) && /\b[34]\d\b/.test(opts.find(o => o.id === 'short').text), `the options do not say their length: ${opts.map(o => o.text).join(' | ')}`);
    expect(await pickLength('short'), 'could not pick Short');
    await sleep(80);
    const hint = await evaluate(`(document.querySelector('#rm-make-hint')?.textContent || '') + ' ' + (document.querySelector('#rm-meter-target')?.textContent || '') + ' ' + (document.querySelector('#rm-length [aria-checked="true"]')?.textContent || '')`);
    expect(/\b[34]\d\s?(s|sec|seconds)\b/i.test(hint), `the short length is not shown (hint, meter target, toggle): "${hint}"`);
    await pickLength('full');
  });
  await step('Create: no Review controls, no old Start UI, nothing marked Soon', async () => {
    const folds = await evaluate(`['#rm-voice', '#rm-captions', '#rm-details', '#rm-revise', '#rm-ready', '#rm-scenes'].filter(s => ${SHOWN}(document.querySelector(s)))`);
    expect(!folds.length, `shown on Create: ${folds.join(', ')}`);
    const old = await oldShown();
    expect(!old.length, `old Start UI still shown: ${old.join(', ')}`);
    const soon = await evaluate(`[...document.querySelectorAll('#main *')].filter(e => e.children.length === 0 && /^\\s*soon\\s*$/i.test(e.textContent) && ${SHOWN}(e)).length`);
    expect(!soon, `${soon} "Soon" labels`);
  });
  await step('Create: "Need a script?" drafts one (script-draft) into the prompt, if offered', async () => {
    const has = await evaluate(`[...document.querySelectorAll('#rm-pane-topic button, #rm-pane-topic a')].some(b => b.id !== 'rm-inspire-link' && /need a script|draft (a|my) script|write (it|a script) for me/i.test(b.textContent) && ${SHOWN}(b))`);
    if (!has) return;
    await typeInto('#rm-prompt', 'Dallas blew a 21-point lead');
    await evaluate(`([...document.querySelectorAll('#rm-pane-topic button, #rm-pane-topic a')].find(b => b.id !== 'rm-inspire-link' && /need a script|draft (a|my) script|write (it|a script) for me/i.test(b.textContent) && ${SHOWN}(b)).click(), 1)`);
    await waitFor(`document.querySelector('#rm-prompt').value.length > 60`, 4000, 'the drafted script in the prompt');
    expect(calls.some(c => c.mode === 'script-draft'), 'no script-draft call');
    await typeInto('#rm-prompt', '');
  });
  await step('Create: Start from a trend and Need an idea?', async () => {
    expect(await visible('#rm-trends'), 'the trend row is not shown');
    expect(/start from a trend|add a story as a source/i.test(await evaluate(`document.querySelector('#rm-pane-topic').textContent`)), 'no "Start from a trend" / "Add a story as a source" heading');
    expect(await visible('#rm-inspire-link'), '"Need an idea?" (#rm-inspire-link) is not shown');
  });
  await step('Need an idea? opens and closes with Escape', async () => {
    await must('#rm-inspire-link');
    await waitFor(`Boolean(document.querySelector('dialog[open]')) || ${SHOWN}(document.querySelector('#rm-radar-host, #rm-ideas-host'))`, 3000, 'the inspiration panel');
    await audit('create-need-an-idea', w);
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

  // Make → making checklist → Review (Breakdown, Full).
  await load();
  scenario.planDelay = 2500;
  await step('Make my reel shows the making checklist', async () => {
    await pickStyle('breakdown');
    await typeInto('#rm-prompt', BRIEF);
    await must('#rm-make');
    await waitFor(`${SHOWN}(document.querySelector('#rm-making')) && document.querySelectorAll('#rm-making li').length >= 3`, 4000, 'the making checklist');
  });
  await audit('making', w);
  scenario.planDelay = 0;
  await step('… then Review', async () => { await waitFor(inReview, 40000, 'the Review step'); });
  await step('Review: a plan v4 in the picked style; the plan request carried the style and the length', async () => {
    const p = await ctx(`(p => p && { v: p.v, esStyle: p.esStyle, style: p.style, chapters: Array.isArray(p.chapters) ? p.chapters.length : 0 })(c.state.plan)`);
    expect(p && p.v === 4 && p.chapters >= 2, `plan in the page: ${JSON.stringify(p)} (want v 4 with chapters)`);
    expect(p.esStyle === 'breakdown' && p.style === 'es', `plan.esStyle ${p.esStyle} / plan.style ${p.style}`);
    const pl = calls.find(c => c.mode === 'plan');
    expect(pl && pl.body.esStyle === 'breakdown', `the plan request sent esStyle ${pl && pl.body.esStyle}`);
    expect(pl.body.v === 4, `the plan request has no v: 4 (v ${pl.body.v})`);
    expect(String(pl.body.script || '').replace(/\s+/g, ' ').trim() === BRIEF, `the plan request does not carry the prompt as the script, word for word: "${String(pl.body.script || '').slice(0, 80)}"`);
    expect(lengthOf(pl.body) === 'full', `the plan request does not say the length (Full): ${JSON.stringify(Object.fromEntries(Object.entries(pl.body).filter(([k]) => /len|dur|short|sec/i.test(k))))}`);
  });
  await step('Review: sourcing (confirmed clips), then the critic, then Ready to post', async () => {
    await waitFor(`/ready to post/i.test(document.querySelector('#rm-ready')?.textContent || '')`, 8000, '"Ready to post"').catch(async e => { throw new Error(`${e.message} (badge "${await readyText()}"; checklist: ${await checklistText()})`); });
    const modes = calls.map(c => c.mode);
    expect(modes.includes('scene-media'), `no scene-media call (calls: ${[...new Set(modes)].join(',')})`);
    const ci = modes.indexOf('critique');
    expect(ci >= 0, `no critique call before Ready to post (calls: ${[...new Set(modes)].join(',')})`);
    expect(ci > modes.indexOf('plan'), 'the critique ran before the plan');
    const sm = calls.find(c => c.mode === 'scene-media');
    expect(v4Style(sm.body) === 'breakdown', `scene-media sent esStyle ${sm.body.esStyle}`);
    expect(sm.body.plan && Array.isArray(sm.body.plan.chapters), 'scene-media was not sent the v4 plan (chapters)');
  });
  await scrollTop();
  await audit('review', w);
  await step('Review: the badge expands to a checklist with the motion rule, the clip rule and the critic', async () => {
    await must('#rm-ready');
    await waitFor(`document.querySelector('#rm-ready').getAttribute('aria-expanded') === 'true'`, 2000, 'the checklist');
    const t = await checklistText();
    expect(/motion|moves|static/i.test(t), `no motion-rule row: ${t}`);
    expect(/clip/i.test(t), `no clip row: ${t}`);
    expect(/critic|hook|pacing|story/i.test(t), `no critic row: ${t}`);
  });
  await audit('review-ready-open', w);
  await click('#rm-ready');
  await step('Review: the chapter strip has one group per chapter and one card per beat', async () => {
    const r = await ctx(`({ ch: (c.state.plan.chapters || []).map(x => ({ id: x.id, n: x.beats.length })), groups: ${CHAPTERS}.map(g => ({ id: g.dataset.chapter || g.dataset.chap, n: g.querySelectorAll('[data-beat]').length })), cards: ${BEAT_CARDS}.length, shown: ${SHOWN}(document.querySelector('#rm-scenes')) })`);
    expect(r.shown, 'the chapter strip (#rm-scenes) is not shown');
    expect(r.groups.length === r.ch.length, `${r.groups.length} [data-chapter] / [data-chap] groups for ${r.ch.length} chapters`);
    r.ch.forEach((c, i) => {
      const g = r.groups[i];
      expect(g && g.id === c.id, `group ${i + 1} is chapter ${g && g.id} (want ${c.id})`);
      expect(g.n === c.n, `chapter ${c.id}: ${g.n} beat cards for ${c.n} beats`);
    });
  });
  await step('Review: every beat card shows a media thumbnail, its module type and its words', async () => {
    const r = await ctx(`${PAGE_BEATS}(c.state.plan).map(b => { const el = ${beatCardExpr('b.id')}; if (!el) return { id: b.id, missing: true }; const txt = el.textContent.replace(/\\s+/g, ' ').toLowerCase(); const words = String(b.vo || '').replace(/\\*/g, '').toLowerCase().split(/\\s+/).map(w => w.replace(/[^a-z0-9']/g, '')).filter(w => w.length > 3).slice(0, 4); const mt = b.module && b.module.type; const human = mt ? String(mt).replace(/([A-Z])/g, ' $1').toLowerCase().trim() : ''; return { id: b.id, thumb: Boolean(el.querySelector('img, canvas, video, [data-beat-thumb]')), module: !mt || txt.includes(mt.toLowerCase()) || txt.includes(human) || Boolean(el.querySelector('[data-module="' + mt + '"], [data-module-type="' + mt + '"]')), words: !words.length || words.some(w => txt.includes(w)), mt }; })`);
    const miss = r.filter(x => x.missing).map(x => x.id);
    expect(!miss.length, `no card for beat(s) ${miss.join(', ')}`);
    const noThumb = r.filter(x => !x.thumb).map(x => x.id);
    const noMod = r.filter(x => !x.module).map(x => `${x.id} (${x.mt})`);
    const noWords = r.filter(x => !x.words).map(x => x.id);
    expect(!noThumb.length && !noMod.length && !noWords.length, `beat cards missing: thumbnail ${noThumb.join(',') || '-'}; module type ${noMod.join(',') || '-'}; words ${noWords.join(',') || '-'}`);
  });

  // Per-beat actions (first width: the same page logic at every width).
  if (first) {
    await step('Review: Swap media gives other verified media, uses the one picked, logs swap_media', async () => {
      const target = await ctx(`(${PAGE_BEATS}(c.state.plan).find(b => b.media && ['clip', 'presser', 'photo'].includes(b.media.kind)) || {}).id`);
      expect(target, 'no media beat in the plan');
      await selectBeat(target);
      const snap = `JSON.stringify([(c.state.photos || {})[${JSON.stringify(target)}], (c.state.media || {})[${JSON.stringify(target)}], (${PAGE_BEATS}(c.state.plan).find(b => b.id === ${JSON.stringify(target)}) || {}).media])`;
      const before = await ctx(snap);
      await clickAction('/swap/i', target, 'Swap media');
      const CAND = `[...document.querySelectorAll('#rm-scenes [data-candidate], #rm-scene-edit [data-candidate], #rm-beat-edit [data-candidate], dialog[open] [data-candidate], [data-swap-pick], [data-swap-list] button, [role="listbox"] [role="option"]')].filter(e => ${SHOWN}(e))`;
      await waitFor(`${CAND}.length >= 1`, 4000, 'swap candidates ([data-candidate], [data-swap-pick], [data-swap-list] button or listbox options)');
      await audit('review-swap-open', w);
      await evaluate(`(() => { const list = ${CAND}; const pick = list.find(e => e.getAttribute('aria-selected') !== 'true' && e.getAttribute('aria-checked') !== 'true') || list[list.length - 1]; pick.click(); return 1; })()`);
      await sleep(400);
      expect((await ctx(snap)) !== before, `beat ${target} media did not change`);
      await expectFeedback('swap_media', 'Swap media');
    });
    await step('Review: Edit changes a beat\'s words and logs edit_text', async () => {
      const target = await ctx(`${PAGE_BEATS}(c.state.plan)[1].id`);
      await selectBeat(target);
      await clickAction('/^\\s*edit\\b|edit (words|text|beat|scene)/i', target, 'Edit');
      await waitFor(`${FIELDS(target)}.length >= 1`, 3000, 'a words field after Edit');
      const NEW = 'Dallas threw it away. Literally.';
      await evaluate(`(() => { const all = ${FIELDS(target)}; const f = all.find(e => /vo|voice|words|script|said/i.test((e.name || '') + (e.id || '') + (e.dataset.field || '') + (e.getAttribute('aria-label') || '') + ((e.closest('label') || {}).textContent || ''))) || all[0]; f.focus(); if ('value' in f) f.value = ${JSON.stringify(NEW)}; else f.textContent = ${JSON.stringify(NEW)}; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); f.blur(); return 1; })()`);
      const saved = await evaluate(`(() => { const b = ${ACTION('/^\\s*(save|done|apply|update)\\b/i', target)}; if (b) { b.click(); return true; } return false; })()`);
      await sleep(400);
      const plan = await ctx(`JSON.stringify(c.state.plan)`);
      expect(/threw it away/i.test(plan), `the edit did not reach the plan (saved with a button: ${saved})`);
      await audit('review-edit', w);
      await expectFeedback('edit_text', 'Edit');
    });
    await step('Review: Change module offers module types and logs change_module', async () => {
      const target = await ctx(`(${PAGE_BEATS}(c.state.plan).find(b => b.module && b.module.type) || {}).id`);
      expect(target, 'no module beat in the plan');
      const before = await ctx(`(${PAGE_BEATS}(c.state.plan).find(b => b.id === ${JSON.stringify(target)}) || {}).module.type`);
      await selectBeat(target);
      await sleep(200);
      const SELECT = `[...document.querySelectorAll('#rm-scene-edit select[data-sb-module], #rm-beat-edit select[data-sb-module], #rm-scenes select[data-sb-module], #rm-scene-edit select[id^="rm-module"]')].filter(e => ${SHOWN}(e))`;
      if (!(await evaluate(`${SELECT}.length`).catch(() => 0))) await clickAction('/module/i', target, 'Change module');
      const OPTS = `[...document.querySelectorAll('[data-module-pick], [data-module-option], [role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"], [role="listbox"] [role="option"], dialog[open] [data-module], #rm-scene-edit select[data-sb-module] option, #rm-scene-edit select[id^="rm-module"] option, #rm-beat-edit select option')].filter(e => e.tagName === 'OPTION' || ${SHOWN}(e))`;
      await waitFor(`${OPTS}.length >= 2`, 3000, 'module choices ([data-module-pick] / menu / listbox / select)');
      await audit('review-change-module', w);
      const picked = await evaluate(`(() => { const list = ${OPTS}; const id = e => e.dataset.modulePick || e.dataset.moduleOption || e.dataset.module || e.value || e.textContent.trim(); const o = list.find(e => id(e) && id(e) !== ${JSON.stringify(before)} && !/^(cancel|close|none)/i.test(id(e))); if (!o) return ''; if (o.tagName === 'OPTION') { const s = o.closest('select'); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } else o.click(); return id(o); })()`);
      expect(picked, 'no other module to pick');
      await sleep(400);
      const after = await ctx(`((${PAGE_BEATS}(c.state.plan).find(b => b.id === ${JSON.stringify(target)}) || {}).module || {}).type`);
      expect(after && after !== before, `module type stayed ${before} (picked ${picked})`);
      await expectFeedback('change_module', 'Change module');
    });
    await step('Review: Ask AI revises the reel and logs regenerate', async () => {
      expect(await visible('#rm-revise'), 'Ask AI (#rm-revise) is not shown');
      await typeInto('#rm-ask-input', 'Lead with the 21-point lead');
      await evaluate(`(document.querySelector('#rm-ask').requestSubmit(), 1)`);
      const voBefore = await ctx(`${PAGE_BEATS}(c.state.plan).map(b => b.vo).join(' ')`);
      await waitFor(`JSON.stringify(window.ReelMakerCtx.state.plan).includes('DALLAS LED BY')`, 6000, 'the revised plan (new headline)');
      expect((await ctx(`${PAGE_BEATS}(c.state.plan).map(b => b.vo).join(' ')`)) === voBefore, 'Ask AI changed the voiceover words (script-first: they stay word for word)');
      const rv = calls.find(c => c.mode === 'revise');
      expect(rv && /21-point/.test(rv.body.instruction), `revise instruction: ${rv && rv.body.instruction}`);
      expect(rv.body.plan && Array.isArray(rv.body.plan.chapters), 'Ask AI did not send the v4 plan');
      expect((await ctx('c.state.plan.esStyle')) === 'breakdown', 'revise dropped the style (plan.esStyle)');
      await expectFeedback('regenerate', 'Ask AI');
    });
    await step('Review: Ask AI on one beat is scoped to that beat', async () => {
      const target = await ctx(`${PAGE_BEATS}(c.state.plan)[2].id`);
      await selectBeat(target);
      const n0 = calls.filter(c => c.mode === 'revise').length;
      // The beat's own Ask AI: a form in its editor ([data-sb-ask]), or an "Ask AI" control that focuses the main box.
      const formSel = `[data-sb-ask]`;
      if (await evaluate(`${SHOWN}(document.querySelector(${JSON.stringify(formSel)}))`)) {
        await evaluate(`(() => { const f = document.querySelector('[data-sb-ask]'); const i = f.querySelector('input, textarea'); i.value = 'Make this beat punchier'; i.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 1; })()`);
      } else await clickAction('/ask ai/i', target, 'Ask AI on a beat');
      await sleep(200);
      if (calls.filter(c => c.mode === 'revise').length === n0 && await visible('#rm-ask-input')) {
        await typeInto('#rm-ask-input', 'Make this beat punchier');
        await evaluate(`(document.querySelector('#rm-ask').requestSubmit(), 1)`);
      }
      const t1 = Date.now();
      while (Date.now() - t1 < 4000 && calls.filter(c => c.mode === 'revise').length === n0) await sleep(150);
      const rv = calls.filter(c => c.mode === 'revise')[n0];
      expect(rv, 'no revise call from the beat\'s Ask AI');
      const named = rv.body.beatId || rv.body.beat || rv.body.target || '';
      expect(named && (rv.body.scope === 'beat' || /beat/i.test(Object.keys(rv.body).join(' '))), `the beat's Ask AI is not scoped to a beat (keys: ${Object.keys(rv.body).join(',')})`);
      expect(named === target, `the beat's Ask AI went to beat ${named}, the picked beat is ${target} (the editor shows another beat than the one picked?)`);
      expect(rv.body.keepVo === true, 'the beat\'s Ask AI does not ask to keep the voiceover words (keepVo)');
    });
    await step('Review: Delete beat (if offered) logs delete_beat', async () => {
      const target = await ctx(`(${PAGE_BEATS}(c.state.plan)[3] || {}).id`);
      await selectBeat(target);
      if (!(await evaluate(`Boolean(${ACTION('/delete scene|^\\s*delete\\s*$/i', target)})`))) return;
      await clickAction('/delete scene|^\\s*delete\\s*$/i', target, 'Delete');
      await sleep(200);
      await evaluate(`(() => { const b = [...document.querySelectorAll('dialog[open] button, [role="alertdialog"] button')].find(x => /delete|remove|yes/i.test(x.textContent)); if (b) b.click(); return 1; })()`);
      await sleep(300);
      expect(!(await ctx(`${PAGE_BEATS}(c.state.plan).some(b => b.id === ${JSON.stringify(target)})`)), `beat ${target} is still in the plan`);
      await expectFeedback('delete_beat', 'Delete beat');
    });
    await audit('review-after-edits', w);
  }
  await step('Review: exactly three folds: Voice & music, Captions, Details', async () => {
    const folds = await evaluate(`[...document.querySelectorAll('#rm-pane-edit details')].filter(d => ${SHOWN}(d)).map(d => d.id + ':' + d.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim())`);
    expect(folds.map(f => f.split(':')[0]).join() === 'rm-voice,rm-captions,rm-details', `folds: ${folds.join(' | ')}`);
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
      const vt = await evaluate(`document.querySelector('#rm-scrub').getAttribute('aria-valuetext')`);
      expect(/chapter 1|scene 1 of \d+/i.test(vt), `scrubber valuetext: ${vt}`);
    });
  }

  // Export (+ export feedback).
  await step('Export step', async () => { await must('#rm-next'); await waitFor(`${SHOWN}(document.querySelector('#rm-pane-export'))`, 4000, 'Export step'); });
  await scrollTop();
  await audit('export-organic', w);
  await step('Export: one Export button plus Also export', async () => {
    const r = await evaluate(`({ exports: [...document.querySelectorAll('#rm-pane-export button')].filter(b => ${SHOWN}(b) && /^\\s*export\\b/i.test(b.textContent) && !b.closest('#rm-also')).length, primary: document.querySelector('#rm-export')?.matches('.es-btn--primary'), also: ${SHOWN}(document.querySelector('#rm-also')), alsoText: document.querySelector('#rm-also')?.textContent.replace(/\\s+/g, ' ') || '', target: ${SHOWN}(document.querySelector('#rm-target')), rights: ${SHOWN}(document.querySelector('#rm-rights, #rm-rights-table')) })`);
    expect(r.exports === 1, `${r.exports} Export buttons outside "Also export"`);
    expect(r.primary, '#rm-export is not the primary button');
    expect(r.also && /also export/i.test(r.alsoText), 'no "Also export" group');
    expect(r.target, 'no Organic / Paid toggle (#rm-target)');
    expect(r.rights, 'no rights summary');
  });
  await step('Paid ad', async () => { await must('#rm-target [data-target="paid"]'); await waitFor(`document.querySelector('#rm-target [data-target="paid"]').getAttribute('aria-checked') === 'true'`, 2000, 'paid picked'); });
  await audit('export-paid', w);
  if (first) {
    // MP4 export on a short test reel (one beat + the close): headless Chrome encodes frame by frame.
    await load();
    Object.assign(scenario, { clips: 'ok', critic: 'pass', motion: 'ok' });
    await step('Export: a one-sentence script makes a short reel', async () => {
      await makeReel({ style: 'hotseat', length: 'short', text: 'Lamar Jackson is the perfect cover for Eric DeCosta.' });
      await must('#rm-next');
      await waitFor(`${SHOWN}(document.querySelector('#rm-pane-export'))`, 4000, 'Export step');
    });
    await step('Export MP4 (and the export feedback event)', async () => {
      // Headless Chrome encodes frame by frame: allow 10x the reel's length + 30 s.
      const reelMs = Number(await ctx('(c.state.timeline && c.state.timeline.durationMs) || 0')) || 90000;
      const exportMs = Math.round(reelMs * 10 + 30000);
      await must('#rm-export');
      await waitFor(`!document.querySelector('#rm-files')?.hidden || /fail|cancel|fix/i.test(document.querySelector('#rm-export-status')?.textContent || '')`, exportMs, `exported file row (${Math.round(exportMs / 1000)} s for a ${Math.round(reelMs / 1000)} s reel)`).catch(async e => { throw new Error(e.message + ' (status: "' + (await evaluate(`(document.querySelector('#rm-export-status')?.textContent || '') + '" gate: "' + (document.querySelector('#rm-gate')?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200)`)) + '")'); });
      const st = await evaluate(`document.querySelector('#rm-export-status').textContent`);
      expect(/^Exported/.test(st), `export said: ${st}`);
      await expectFeedback('export', 'Export');
      const ex = await evaluate('window.__qaExported || []');
      expect(ex.some(e => e.tool === 'reels-studio' && /mp4|webm/i.test(String(e.format || ''))), `FrameUpTrack.exported() did not fire for the MP4 (${JSON.stringify(ex).slice(0, 160)})`);
    });
    await sleep(900);
    await audit('export-done', w);
  }

  // The Ready to post gate: no clip → not ready → "Find clips" → ready.
  await load();
  Object.assign(scenario, { clips: 'none-once', critic: 'pass' }); // later sourcing calls (Find clips) find them
  await step('Ready gate: a reel with no confirmed clip is not Ready to post and offers Find clips', async () => {
    await makeReel({ style: 'hotseat' });
    await sleep(1500);
    const t = await readyText();
    expect(!READY_RE.test(t), `a draft with no confirmed clip says "Ready to post": "${t}"`);
    expect(/needs clips|draft/i.test(t), `the badge does not say Needs clips / Draft: "${t}"`);
    if (!(await evaluate(`${FIND_CLIPS}.length`))) { await click('#rm-ready'); await sleep(200); }
    expect(/clip/i.test(t + ' ' + await checklistText()), `the badge / checklist does not say a clip is needed: "${t}" / ${await checklistText()}`);
    expect(await evaluate(`${FIND_CLIPS}.length`) >= 1, 'no "Find clips" action on the badge, its checklist or the beats');
  });
  await scrollTop();
  await audit('review-needs-clips', w);
  await step('Ready gate: Export holds or warns while there is no clip', async () => {
    await must('#rm-next');
    await sleep(300);
    const r = await evaluate(`({ gate: (document.querySelector('#rm-gate')?.textContent || '').replace(/\\s+/g, ' ').trim(), pane: (document.querySelector('#rm-pane-export')?.textContent || '').replace(/\\s+/g, ' '), held: document.querySelector('#rm-export')?.getAttribute('aria-disabled') === 'true' || Boolean(document.querySelector('#rm-export')?.disabled) })`);
    expect(r.held || /clip/i.test(r.gate) || /find clips|no clip|needs? (a )?clip/i.test(r.pane), `Export shows no clip warning or hold (gate "${r.gate.slice(0, 120)}")`);
    await audit('export-needs-clips', w);
    await must('#rm-back');
    await waitFor(inReview, 4000, 'back to Review');
  });
  await step('Ready gate: Find clips sources clips and the badge turns Ready to post', async () => {
    const n0 = calls.length;
    const ok = await evaluate(`(() => { const b = ${FIND_CLIPS}[0]; if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
    expect(ok, 'no Find clips control');
    await waitFor(`/^\\s*ready to post/i.test((document.querySelector('#rm-ready')?.textContent || '').trim())`, 10000, '"Ready to post" after Find clips').catch(async e => { throw new Error(`${e.message} (badge "${await readyText()}"; new calls: ${calls.slice(n0).map(c => c.path.replace('/api/', '') + ':' + c.mode).join(', ')})`); });
    const sourcing = calls.slice(n0).filter(c => /media|clip/i.test(String(c.mode)) || c.path === '/api/video-ads');
    expect(sourcing.length >= 1, `Find clips made no sourcing call (calls: ${calls.slice(n0).map(c => c.mode).join(',')})`);
  });
  await audit('review-found-clips', w);

  // A failing critic keeps the badge from passing (fixes shown).
  await load();
  Object.assign(scenario, { clips: 'ok', critic: 'fail' });
  await step('Ready gate: a critic fail is not Ready to post and shows the fix', async () => {
    await makeReel({ style: 'outlier' });
    const t1 = Date.now();
    while (Date.now() - t1 < 6000 && !calls.some(c => c.mode === 'critique')) await sleep(150);
    expect(calls.some(c => c.mode === 'critique'), 'no critique call');
    await sleep(800);
    const t = await readyText();
    expect(!READY_RE.test(t), `the badge says "${t}" though the critic failed`);
    expect(/critic flagged|to fix/i.test(t), `the badge does not say "Critic flagged" / "N to fix": "${t}"`);
    await click('#rm-ready'); await sleep(200);
    const list = await checklistText();
    expect(/hook|21-point|critic|fix/i.test(list + ' ' + t), `the critic's fix is not shown: "${t}" / ${list}`);
  });
  await audit('review-critic-fail', w);
  scenario.critic = 'pass';

  // A beat that does not move keeps the badge from passing (clips and critic fine).
  await load();
  Object.assign(scenario, { clips: 'ok', critic: 'pass', motion: 'static' });
  await step('Ready gate: a static beat (motionOk false) is not Ready to post and names the beat', async () => {
    await makeReel({ style: 'breakdown' });
    await sleep(1500);
    const t = await readyText();
    expect(!READY_RE.test(t), `the badge says "${t}" though a beat does not move`);
    await click('#rm-ready'); await sleep(200);
    const list = await checklistText();
    expect(/mov|static|motion|still/i.test(list + ' ' + t), `the motion problem is not shown: "${t}" / ${list}`);
    expect(/\d+ static scene|static|to fix/i.test(t), `the badge does not count the static scene ("N static scenes"): "${t}"`);
  });
  await audit('review-static-beat', w);
  scenario.motion = 'ok';

  // The critic did not run (an error): that row does not block Ready to post.
  await load();
  Object.assign(scenario, { clips: 'ok', critic: 'error', motion: 'ok' });
  await step('Ready gate: a critic that did not run does not block Ready to post', async () => {
    await makeReel({ style: 'hotseat' });
    await waitFor(`/^\s*ready to post/i.test((document.querySelector('#rm-ready')?.textContent || '').trim())`, 8000, '"Ready to post" with the critic down').catch(async e => { throw new Error(`${e.message} (badge "${await readyText()}"; checklist: ${await checklistText()})`); });
  });
  scenario.critic = 'pass';

  // Every style makes a reel in its own style; Short makes a short plan (first width only).
  if (first) {
    for (let i = 0; i < 4; i++) {
      const id = STYLE_IDS[i];
      await load();
      Object.assign(scenario, { clips: 'ok', critic: 'pass' });
      const len = i % 2 ? 'short' : 'full';
      await step(`style ${id} (${len}): Make my reel → Review, Ready to post`, async () => {
        await makeReel({ style: id, length: len });
        const p = await ctx(`({ esStyle: c.state.plan.esStyle, v: c.state.plan.v, n: (c.state.plan.chapters || []).length })`);
        expect(p.esStyle === id && p.v === 4, `plan ${JSON.stringify(p)}`);
        const pl = calls.find(c => c.mode === 'plan');
        expect(lengthOf(pl.body) === len, `the plan request length is "${lengthOf(pl.body)}" (picked ${len})`);
        await waitFor(`/ready to post/i.test(document.querySelector('#rm-ready')?.textContent || '')`, 8000, '"Ready to post"').catch(async e => { throw new Error(`${e.message} (badge "${await readyText()}"; open rows: ${(await checklistText()).split(' / ').filter(r => !/passes$/i.test(r)).join(' / ').slice(0, 300)})`); });
        const sm = calls.find(c => c.mode === 'scene-media');
        expect(!sm || v4Style(sm.body) === id, `scene-media esStyle ${sm && sm.body.esStyle}`);
      });
      await scrollTop();
      await audit(`review-style-${id}`, w);
    }
  }

  // Script mode: the person's words, never rewritten.
  await load();
  scenario.planFrom = 'server';
  const SCRIPT = 'Dallas was up 21. They lost on a 59-yard field goal with two seconds left. Everyone blames the fourth down. It was not the fourth down.';
  await step('script mode keeps the words (and the page holds a v4 plan)', async () => {
    expect(await evaluate(`Boolean(document.querySelector('#rm-script-mode'))`), 'no "Use my exact words" switch (#rm-script-mode)');
    await makeReel({ style: 'breakdown', text: SCRIPT, script: true });
    const vo = await ctx(`${PAGE_BEATS}(c.state.plan).map(b => b.vo).filter(Boolean).join(' ')`);
    expect(vo.replace(/\*/g, '') === SCRIPT, `VO changed: ${vo}`);
    expect((await ctx('c.state.plan.v')) === 4, `the script plan is not v4 in the page (v ${await ctx('c.state.plan.v')}; ReelES.toV4 should convert it)`);
  });
  await scrollTop();
  await audit('script-review', w);

  // Trends empty / error, free mode, server offline.
  Object.assign(scenario, { trends: 'empty' }); await load(); await sleep(400); await audit('create-trends-empty', w);
  Object.assign(scenario, { trends: 'error' }); await load(); await sleep(400); await audit('create-trends-error', w);
  Object.assign(scenario, { trends: 'ok', config: 'free' }); await load(); await sleep(600);
  await audit('free-create', w);
  await step('free mode make', async () => { await makeReel({ style: 'outlier', text: 'Victor Wembanyama has 5+ blocks in 9 straight games, the longest streak since 1985-86.' }); });
  await scrollTop();
  await audit('free-review', w);
  Object.assign(scenario, { config: 'offline' }); await load(); await sleep(600);
  await audit('offline-create', w);
  await step('offline draft', async () => { await makeReel({ style: 'breakdown', text: 'Scottie Scheffler won the Masters by four shots for his third major.' }); });
  await scrollTop();
  await audit('offline-review', w);
  Object.assign(scenario, { config: 'ok', planFrom: 'fixture' });
  if (Date.now() - t0 > 900000 && w !== WIDTHS[WIDTHS.length - 1]) { behaviour.push('time budget hit: some widths not swept'); break; }
}

cleanup();
const bad = results.filter(r => r.issues.length);
const warnTotal = results.reduce((n, r) => n + r.warns.length, 0);
for (const r of bad) console.log(`FAIL ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.issues)].join(' | ')}`);
for (const b of [...new Set(behaviour)]) console.log(`FAIL behaviour: ${b}`);
if (process.env.REELS_WARN) for (const r of results.filter(x => x.warns.length)) console.log(`warn ${r.width}/${r.theme}/${r.state}: ${[...new Set(r.warns)].join(' | ')}`);
console.log(`reels ui: ${stateCount} states swept (${WIDTHS.join('/')} × light/dark), ${bad.length} with problems, ${behaviour.length} behaviour failures, ${warnTotal} off-grid spacing notes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || behaviour.length ? 1 : 0);
