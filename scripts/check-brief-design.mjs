// Design from a brief (frameup-brief.js) in real headless Chrome: the brief
// box in the editor, with /api/* stubbed (no AI, no Supabase, no network).
// Behaviour:
//   the box mounts above the canvas on editors that have brief templates, and
//   not at all with the flag off; ⌘K lists "Design from brief";
//   a brief opens the best option in the editor as ONE undo step (Undo
//   restores the old design, Redo brings the brief design back), in under 8 s
//   with a 2.5 s server; three options show as thumbnails, best first;
//   picking another option, Rewrite (shorter), Swap photo and Export work;
//   an X post brief fills the tweet card from the link's data (no sample
//   numbers); free mode notes it; errors (500, 429) show a calm message with
//   Try again; the learning rows are queued (brief-design on open,
//   brief-export with kept / changed on export) and the export record carries
//   metadata.generated.source = 'brief'.
// UI (idle, working, result, error) at 1440, 1024 and 375, light and dark:
//   fonts, contrast, clipped text, controls spilling out, misaligned buttons,
//   unlabelled controls, broken images, horizontal scroll, off-grid spacing
//   inside the brief box, console errors.
// Run: node scripts/check-brief-design.mjs  (skips without Chrome)
//   BRIEF_SHOTS=<dir> saves a screenshot of every state.
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, startServer, startChrome, sleep, FAKE_SESSION, figureSvg } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('brief design: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('brief design: skipped (needs Node with WebSocket)'); process.exit(0); }

const SHOTS = process.env.BRIEF_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ─── Stub server ───────────────────────────────────────────────────────────
const STAT_OPTION = {
  template: 'player-stat-line', label: 'Player Stat Line', why: 'Three stats from one game, with the team logo', layout: 'default',
  fields: { firstName: 'LeBron', lastName: 'James', opponent: 'V/S THE SUNS', stats: [{ value: '41', label: 'PTS' }, { value: '12', label: 'AST' }, { value: '9', label: 'REB' }] },
  lines: ['LeBron James', 'V/S THE SUNS', '41 | PTS', '12 | AST', '9 | REB'], listicle: null, sport: 'NBA', team: 'Los Angeles Lakers', warnings: [], source: 'ai',
};
const COVER_OPTION = {
  template: 'cover', label: 'Cover Image', why: 'A big headline over his photo', layout: 'stagger',
  fields: { pills: ['LeBron James', 'Drops 41', 'On The Suns'] }, lines: ['LeBron James', 'Drops 41', 'On The Suns'], listicle: null, sport: 'NBA', team: 'Los Angeles Lakers', warnings: ['the Cover runs 6 words'], source: 'ai',
};
const RECORD_OPTION = {
  template: 'team-record', label: 'Team Record / Score', why: 'The final score as one huge number', layout: 'default',
  fields: { record: '120-112', subline: 'LAKERS BEAT THE SUNS' }, lines: ['120-112', 'LAKERS BEAT THE SUNS'], listicle: null, sport: 'NBA', team: 'Los Angeles Lakers', warnings: [], source: 'ai',
};
const TWEET = { url: 'https://x.com/espn/status/1234567890', authorName: 'ESPN', handle: 'espn', text: 'LeBron James tonight: 41 points, 12 assists, 9 rebounds.', dateLabel: 'Nov 26, 2026', metrics: '', avatarDataUrl: '', avatarUrl: '', verified: true };
const TWEET_OPTION = { template: 'twitter-quote', label: 'Tweet / X Post', why: 'It links an X post', layout: 'default', fields: { headline: 'LeBron Goes Off' }, lines: ['LeBron Goes Off'], listicle: null, sport: 'NBA', team: '', warnings: [], source: 'ai' };
const withIds = list => list.map((option, rank) => ({ ...option, id: `brief-qa-${rank}`, rank }));

let mode = 'ok'; // ok | free | error500 | error429 | tweet | slow
let calls = [];
const api = async (req, url, body) => {
  if (url.pathname !== '/api/brief-design') return null;
  calls.push(body);
  if (body?.mode === 'rewrite') {
    const option = body.option || {};
    if (option.template === 'cover') {
      const pills = ['LeBron 41', 'Vs Suns'];
      return { status: 200, delay: 400, body: { option: { ...option, fields: { pills }, lines: pills }, costUsd: 0.0006 } };
    }
    return { status: 422, body: { error: 'No better version this time. Try another.' } };
  }
  if (mode === 'error500') return { status: 500, delay: 300, body: { error: 'Design from a brief failed. Try again in a moment.' } };
  if (mode === 'error429') return { status: 429, delay: 300, body: { error: "You've made a lot of designs this hour. Take a short break and try again soon.", reason: 'limit' } };
  if (mode === 'tweet') return { status: 200, delay: 800, body: { options: withIds([TWEET_OPTION, COVER_OPTION]), photos: [], tweets: [TWEET], subject: 'LeBron James', notes: [], engine: 'ai', ms: 800, costUsd: 0.0011 } };
  if (mode === 'free') {
    return { status: 200, delay: 300, body: { options: withIds([{ ...COVER_OPTION, source: 'rules', why: 'A headline over a photo' }]), photos: [], tweets: [], subject: 'LeBron James', notes: [], engine: 'free', ms: 300, costUsd: 0, ok: true, mode: 'free', reason: 'user-limit', notice: 'You reached your AI limit for this week, so this was designed from your words without AI.' } };
  }
  return {
    status: 200,
    delay: mode === 'slow' ? 2500 : 600,
    body: {
      options: withIds([STAT_OPTION, COVER_OPTION, RECORD_OPTION]),
      photos: [{ url: '/__qa/photo/lebron-1.svg', title: 'LeBron James' }, { url: '/__qa/photo/lebron-2.svg', title: 'LeBron James' }],
      tweets: [], subject: 'LeBron James', notes: [], engine: 'ai', ms: 2500, costUsd: 0.0021,
      shortlist: [{ value: 'player-stat-line', score: 3 }, { value: 'cover', score: 1 }],
    },
  };
};
const extra = url => {
  const m = url.pathname.match(/^\/__qa\/photo\/([a-z0-9-]+)\.svg$/);
  if (!m) return null;
  return { type: 'image/svg+xml', body: figureSvg({ pose: m[1].endsWith('2') ? 'bust' : 'stand', cutout: false, colour: '#552583' === '' ? '#1D428A' : '#FDB927' }) };
};
const { server, base } = await startServer({ api, extra });
const browser = await startChrome(CHROME, { width: 1440, height: 900 });
const { send, evaluate } = browser;
const errors = [];
browser.on(m => {
  if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 200));
});
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); };
const debug = async expr => { if (process.env.BRIEF_DEBUG) console.log('DEBUG', await evaluate(expr).catch(e => String(e))); };
const waitFor = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr).catch(() => false)) return true; await sleep(120); } return false; };

// ─── UI scan, scoped to the brief box ──────────────────────────────────────
const SCAN = `(() => {
  const issues = []; const grid = [];
  const box = document.querySelector('.fu-brief');
  if (!box) return { issues: ['no brief box'], grid };
  const rgb = v => { const m = String(v).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const name = e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : '');
  const vis = e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1 && !e.closest('[hidden]') && !e.closest('.fu-brief__sr'); };
  const all = [box, ...box.querySelectorAll('*')].filter(e => !['svg', 'path', 'circle', 'rect'].includes(e.tagName.toLowerCase()) && vis(e));
  const W = innerWidth;
  if (document.scrollingElement.scrollWidth > W + 1) issues.push('horizontal scroll: ' + document.scrollingElement.scrollWidth + ' at ' + W);
  const br = box.getBoundingClientRect();
  if (br.left < -1 || br.right > W + 1) issues.push('brief box off screen ' + Math.round(br.left) + '..' + Math.round(br.right));
  const bgOf = e => { const layers = []; for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.backgroundImage !== 'none' && !a.classList.contains('fu-brief__bar')) return null; const c = rgb(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; } } let base = { r: 255, g: 255, b: 255 }; for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; } return base; };
  all.forEach(e => {
    const s = getComputedStyle(e);
    const text = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (text) {
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (!/^(Roboto|Roboto Condensed|Acumin)/i.test(fam)) issues.push('font ' + fam + ' on ' + name(e));
      if (!e.closest(':disabled')) {
        const fg = rgb(s.color); const bg = bgOf(e);
        if (fg && bg) { let op = 1; for (let a = e; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity); const ink = { r: fg.r * op + bg.r * (1 - op), g: fg.g * op + bg.g * (1 - op), b: fg.b * op + bg.b * (1 - op) }; const size = parseFloat(s.fontSize); const need = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5; const r = ratio(ink, bg); if (r < need - 0.02) issues.push('contrast ' + r.toFixed(2) + ' "' + text.slice(0, 24) + '" on ' + name(e)); }
      }
      if (/hidden|clip/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis') issues.push('clipped text "' + text.slice(0, 24) + '" on ' + name(e));
      const range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect();
      if (tr.width && (tr.right > br.right + 1 || tr.left < br.left - 1) && s.textOverflow !== 'ellipsis') issues.push('text outside the box "' + text.slice(0, 24) + '"');
    }
    if (e.matches('button, textarea, input:not([type=hidden]):not([type=file]), [role=radio], [role=menuitem]')) {
      const lab = e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('title') || '';
      if (!lab) issues.push('unlabelled ' + name(e));
      const r = e.getBoundingClientRect(); const p = e.closest('[role=menu]') ? null : e.closest('.fu-brief__bar, .fu-brief__panel, .fu-brief__chip')?.getBoundingClientRect();
      if (p && (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1)) issues.push('spills out: ' + name(e));
    }
    if (e.tagName === 'IMG' && e.getAttribute('src') && e.complete && !e.naturalWidth) issues.push('broken image');
    const sp = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(k => parseFloat(s[k]));
    if (/flex|grid/.test(s.display)) { const g1 = parseFloat(s.rowGap), g2 = parseFloat(s.columnGap); if (!isNaN(g1)) sp.push(g1); if (!isNaN(g2)) sp.push(g2); }
    if (!e.matches('textarea') && sp.some(v => v > 2.5 && Math.abs(v - Math.round(v / 4) * 4) > 0.6)) grid.push(name(e) + ' ' + sp.join('/'));
  });
  // Buttons in one row share a height.
  const rows = new Map();
  box.querySelectorAll('button').forEach(b => { if (!vis(b)) return; const p = b.parentElement; const r = b.getBoundingClientRect(); const key = p; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(r); });
  for (const [p, rs] of rows) { const byTop = new Map(); rs.forEach(r => { const k = Math.round(r.top / 3); byTop.set(k, [...(byTop.get(k) || []), r.height]); }); for (const hs of byTop.values()) if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 1.5) issues.push('misaligned buttons in ' + name(p) + ': ' + hs.map(Math.round).join('/')); }
  // The canvas stays on screen (desktop).
  const c = document.getElementById('preview')?.getBoundingClientRect();
  if (W > 900 && c && (c.bottom > innerHeight + 2 || c.height < 200)) issues.push('canvas pushed off screen (' + Math.round(c.top) + '..' + Math.round(c.bottom) + ')');
  return { issues: [...new Set(issues)], grid: [...new Set(grid)] };
})()`;

const WIDTHS = [1440, 1024, 375];
const THEMES = ['light', 'dark'];
const uiIssues = [];
const gridAll = new Set();
async function setSize(w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 500 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 500 });
}
async function sweep(state, { widths = WIDTHS } = {}) {
  for (const w of widths) {
    await setSize(w);
    await sleep(350);
    for (const theme of THEMES) {
      await evaluate(`(window.FrameUpTheme?.apply ? window.FrameUpTheme.apply(${JSON.stringify(theme)}) : (document.documentElement.dataset.theme = ${JSON.stringify(theme)}), true)`);
      await sleep(200);
      let r = await evaluate(SCAN);
      if (r.issues.length) { await sleep(800); r = await evaluate(SCAN); }
      r.issues.forEach(issue => uiIssues.push(`${state} ${w} ${theme}: ${issue}`));
      r.grid.forEach(g => gridAll.add(g));
      if (SHOTS) {
        await evaluate(`document.querySelector('.fu-brief')?.scrollIntoView({ block: 'nearest' }), true`);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result?.data) fs.writeFileSync(path.join(SHOTS, `${state}-${w}-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
      }
    }
  }
  await setSize(1440);
  await evaluate(`(window.FrameUpTheme?.apply ? window.FrameUpTheme.apply('light') : (document.documentElement.dataset.theme = 'light'), true)`);
  await sleep(200);
}

async function open(hash = 'instagram', query = '') {
  await send('Page.navigate', { url: `${base}/__blank` });
  await waitFor(`location.pathname === '/__blank'`);
  await evaluate(FAKE_SESSION);
  await evaluate(`(() => { let h = 0x811c9dc5; for (const ch of 'qa@essentiallysports.com') { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } for (const k of ['frameup.tours.v1:u' + h.toString(36), 'frameup.tours.v1:device']) localStorage.setItem(k, JSON.stringify({ welcome: 'never' })); localStorage.removeItem('frameup.usage.pending.v1'); return true; })()`);
  await send('Page.navigate', { url: `${base}/index.html${query}#${hash}` });
  const ok = await waitFor(`document.readyState === 'complete' && Boolean(window.FrameUpSpec) && document.body.dataset.currentPage === ${JSON.stringify(hash)}`, 30000);
  if (!ok) throw new Error('the editor did not load: ' + await evaluate('location.href'));
  await sleep(1200);
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*{animation:none!important;transition:none!important}'; document.head.appendChild(s); document.querySelector('.fu-tour-toast, .fu-offer')?.remove(); return true; })()`);
}
const typeBrief = text => evaluate(`(() => { const b = document.getElementById('fu-brief-input'); b.focus(); b.value = ${JSON.stringify(text)}; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const submit = () => evaluate(`(() => { document.querySelector('.fu-brief [data-brief="go"]').click(); return true; })()`);
const resultShown = `!document.querySelector('.fu-brief__result').hidden && !document.querySelector('.fu-brief').classList.contains('is-busy')`;
const idle = `!document.querySelector('.fu-brief').classList.contains('is-busy')`;
const queued = () => evaluate(`JSON.parse(localStorage.getItem('frameup.usage.pending.v1') || '[]').filter(r => r.category === 'generate' && /^brief-/.test(r.action)).map(r => ({ action: r.action, meta: r.meta }))`);

let exitCode = 0;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://*.supabase.co/*', '*://*.essentiallysports.com/*', '*vercel*', '*google-analytics*', '*googletagmanager*', '*fonts.googleapis.com*'] });
  const started = Date.now();

  // ── Flag off: nothing added.
  await open('instagram', '?brief=off');
  expect(await evaluate(`!document.querySelector('.fu-brief') && !window.FrameUpBriefCore`), 'flag off: no brief box and no extra scripts');

  // ── Idle.
  await open('instagram');
  expect(await waitFor(`Boolean(document.querySelector('.canvas-stack > .fu-brief:first-child'))`, 8000), 'idle: the brief box sits at the top of the canvas column');
  expect(await evaluate(`document.getElementById('fu-brief-input').placeholder.startsWith('Describe what you need')`), 'idle: placeholder "Describe what you need…"');
  await sweep('idle');

  // ⌘K lists it.
  await evaluate(`window.FrameUpShell.openPalette(), true`);
  await sleep(200);
  await evaluate(`(() => { const i = document.querySelector('.es-palette input'); i.value = 'brief'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  expect(await evaluate(`[...document.querySelectorAll('.es-palette .es-menu__item')].some(i => /Design from brief/.test(i.textContent))`), '⌘K: "Design from brief" is listed');
  await evaluate(`(() => { const item = [...document.querySelectorAll('.es-palette .es-menu__item')].find(i => /Design from brief/.test(i.textContent)); item?.click(); return true; })()`);
  await sleep(200);
  expect(await evaluate(`document.activeElement?.id === 'fu-brief-input'`), '⌘K: "Design from brief" focuses the brief box');

  // Something on the canvas first, so Undo has a design to return to.
  await evaluate(`(() => { const t = document.getElementById('pill-text'); t.value = 'OLD HEADLINE'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(1300);
  expect(await evaluate(`JSON.stringify(state.lines) === '["OLD HEADLINE"]'`), 'setup: the old design is on the canvas');

  // ── Working (slow server: the steps show), then ready.
  mode = 'slow';
  calls = [];
  await typeBrief('LeBron James drops 41 points, 12 assists and 9 rebounds as the Lakers beat the Suns 120-112');
  const t0 = Date.now();
  await submit();
  expect(await waitFor(`!document.querySelector('.fu-brief__progress').hidden`, 2000), 'working: the progress line shows');
  await sleep(300);
  await sweep('working', { widths: [1440, 375] });
  expect(await waitFor(resultShown, 20000), 'ready: the result panel shows');
  const readyMs = Number(await evaluate(`document.querySelector('.fu-brief').dataset.readyMs || 0`));
  expect(readyMs > 0 && readyMs < 8000, `ready in under 8 s (took ${readyMs} ms with a 2.5 s server)`);
  expect(calls[0]?.mode === 'design' && calls[0]?.workspace === 'instagram' && /LeBron/.test(calls[0]?.brief || ''), 'request: mode design, workspace, brief');
  await debug(`JSON.stringify({ t: state.postType, d: state.playerStatLineData, s: window.FrameUpBrief.session()?.current, f: window.FrameUpBrief.session()?.fixed, l: window.FrameUpBrief.session()?.left })`);
  expect(await evaluate(`state.postType === 'player-stat-line' && state.playerStatLineData.lastName === 'JAMES' && state.playerStatLineData.stats[0].value === '41'`), 'ready: the best option (Player Stat Line) is in the editor');
  expect(await evaluate(`document.querySelectorAll('.fu-brief__opt').length === 3 && document.querySelector('.fu-brief__opt[aria-checked="true"]')?.dataset.option === '0' && /Best match/.test(document.querySelector('.fu-brief__opt').textContent)`), 'ready: three options, best first and selected');
  expect(await waitFor(`[...document.querySelectorAll('.fu-brief__thumb')].every(img => img.getAttribute('src') && img.naturalWidth > 0)`, 25000), 'ready: all three thumbnails render (the hidden renderer)');
  expect(await evaluate(`/Player Stat Line/.test(document.querySelector('.fu-brief__why').textContent) && /Three stats/.test(document.querySelector('.fu-brief__why').textContent)`), 'ready: the template and its one-line reason');
  expect(await evaluate(`Boolean(state.photo) && /LeBron/.test(state.photoName)`), 'ready: the checked ES photo is on the design');
  let rows = await queued();
  expect(rows.some(r => r.action === 'brief-design' && r.meta.template === 'player-stat-line' && r.meta.ws === 'instagram' && r.meta.rank === 0), 'learning: a brief-design row is queued on open');
  await sweep('result');

  // One undo step.
  await evaluate(`document.querySelector('[data-history="undo"]').click(), true`);
  await sleep(700);
  expect(await evaluate(`state.postType === 'cover' && JSON.stringify(state.lines) === '["OLD HEADLINE"]'`), 'undo: ONE step returns to the old design');
  await evaluate(`document.querySelector('[data-history="redo"]').click(), true`);
  await sleep(700);
  expect(await evaluate(`state.postType === 'player-stat-line'`), 'redo: the brief design comes back');

  // Try another template (the next option: Cover).
  await evaluate(`document.querySelector('[data-brief="another"]').click(), true`);
  expect(await waitFor(`state.postType === 'cover' && JSON.stringify(state.lines) === '["LeBron James","Drops 41","On The Suns"]'`, 8000), 'try another: the Cover option opens');
  await waitFor(idle, 8000);
  expect(await evaluate(`document.querySelector('.fu-brief__opt[aria-checked="true"]')?.dataset.option === '1'`), 'try another: its thumbnail is selected');
  expect(await evaluate(`[...document.querySelectorAll('.fu-brief__note')].some(n => /6 words/.test(n.textContent))`), 'notes: the option warning shows as a small note');

  // Rewrite: shorter.
  await evaluate(`document.querySelector('[data-brief="rewrite"]').click(), true`);
  expect(await evaluate(`!document.querySelector('.fu-brief__menu').hidden && document.activeElement?.dataset.how === 'shorter'`), 'rewrite: the menu opens with focus on Shorter');
  await sweep('rewrite-menu', { widths: [1440] });
  await evaluate(`document.querySelector('[data-how="shorter"]').click(), true`);
  expect(await waitFor(`JSON.stringify(state.lines) === '["LeBron 41","Vs Suns"]'`, 8000), 'rewrite: the shorter text is on the design');
  await waitFor(idle, 8000);
  expect(calls.some(c => c.mode === 'rewrite' && c.how === 'shorter' && c.option?.template === 'cover'), 'rewrite: sends the option and how');

  // Swap photo.
  const before = await evaluate(`state.photo?.src || ''`);
  await evaluate(`document.querySelector('[data-brief="swap"]').click(), true`);
  expect(await waitFor(`(state.photo?.src || '') !== ${JSON.stringify(before)} && /lebron-2/.test(state.photo?.src || '')`, 6000), 'swap photo: the next checked photo');
  await waitFor(idle, 8000);

  // Pick option 3 by its thumbnail.
  await evaluate(`document.querySelector('.fu-brief__opt[data-option="2"]').click(), true`);
  expect(await waitFor(`state.postType === 'team-record' && state.teamRecordData.record === '120-112'`, 8000), 'pick: the third option opens');
  await waitFor(idle, 8000);

  // Export: the learning row and the export record.
  await evaluate(`document.querySelector('[data-brief="export"]').click(), true`);
  await sleep(1500);
  rows = await queued();
  const exportRow = rows.find(r => r.action === 'brief-export');
  expect(exportRow && exportRow.meta.template === 'team-record' && exportRow.meta.kept === true, `export: a brief-export row, kept unchanged (${JSON.stringify(exportRow?.meta || null)})`);
  expect(rows.filter(r => r.action === 'brief-export').length === 1, 'export: one learning row per export');
  expect(await evaluate(`(() => { const list = JSON.parse(localStorage.getItem(window.ESDashboardData.DESIGNS_KEY) || '[]'); const g = list[0]?.metadata?.generated; return g?.source === 'brief' && g.template === 'team-record' && g.kept === true; })()`), 'export: the export record says it came from a brief');
  // An edit, then a second export: changed.
  await evaluate(`(() => { state.teamRecordData = { ...state.teamRecordData, subline: 'BIG WIN' }; render(); return true; })()`);
  await sleep(4500);
  await evaluate(`window.downloadImage(), true`);
  await sleep(1500);
  rows = await queued();
  const second = rows.filter(r => r.action === 'brief-export')[1];
  expect(second && second.meta.kept === false && second.meta.changed >= 1, `export after an edit: kept false (${JSON.stringify(second?.meta || null)})`);

  // Escape closes the panel; the design stays.
  await evaluate(`document.getElementById('fu-brief-input').focus(), document.getElementById('fu-brief-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  await sleep(200);
  expect(await evaluate(`document.querySelector('.fu-brief__panel').hidden && state.postType === 'team-record'`), 'Escape closes the panel and keeps the design');

  // ── An X post brief: the tweet card from the link, no sample numbers.
  mode = 'tweet';
  await typeBrief('LeBron reacts https://x.com/espn/status/1234567890');
  await submit();
  expect(await waitFor(resultShown, 15000), 'tweet: ready');
  expect(await evaluate(`state.postType === 'twitter-quote' && state.tweetQuote.text === ${JSON.stringify(TWEET.text)} && state.tweetQuote.headline === 'LeBron Goes Off' && state.tweetQuote.metrics === ''`), 'tweet: the card shows the linked post and the headline, never sample metrics');

  // ── Own photo.
  mode = 'ok';
  await evaluate(`(async () => { const svg = ${JSON.stringify(figureSvg({ pose: 'swing', cutout: false }))}; const blob = new Blob([svg], { type: 'image/svg+xml' }); const file = new File([blob], 'my-shot.svg', { type: 'image/svg+xml' }); const dt = new DataTransfer(); dt.items.add(file); const input = document.querySelector('.fu-brief__file'); input.files = dt.files; input.dispatchEvent(new Event('change')); return true; })()`);
  expect(await waitFor(`!document.querySelector('.fu-brief__chip').hidden`, 5000), 'own photo: the chip shows');
  await sweep('own-photo', { widths: [1440, 375] });
  calls = [];
  await typeBrief('LeBron James drops 41 points, 12 assists and 9 rebounds as the Lakers beat the Suns 120-112');
  await submit();
  expect(await waitFor(resultShown, 15000), 'own photo: ready');
  expect(calls[0]?.ownPhoto === true, 'own photo: the request says so');
  expect(await evaluate(`/^data:image\\/jpeg/.test(state.photo?.src || '')`), 'own photo: it is the photo on the design');

  // ── Free mode.
  mode = 'free';
  await typeBrief('LeBron James is unstoppable');
  await submit();
  expect(await waitFor(resultShown, 15000), 'free mode: ready');
  expect(await evaluate(`[...document.querySelectorAll('.fu-brief__note')].some(n => /without AI/.test(n.textContent)) && document.querySelectorAll('.fu-brief__opt').length === 1`), 'free mode: the note shows, one rules option');
  expect(await evaluate(`document.querySelector('[data-brief="another"]').disabled`), 'free mode: Try another is off with one option');
  await sweep('free');

  // ── Errors.
  mode = 'error500';
  await typeBrief('LeBron James is unstoppable');
  await submit();
  expect(await waitFor(`!document.querySelector('.fu-brief__error').hidden`, 8000), 'error 500: the error line shows');
  expect(await evaluate(`/Try again/.test(document.querySelector('.fu-brief__error').textContent) && !document.querySelector('[data-brief="retry"]').hidden`), 'error 500: Try again is offered');
  await sweep('error');
  mode = 'error429';
  await evaluate(`document.querySelector('[data-brief="retry"]').click(), true`);
  expect(await waitFor(`/short break/.test(document.querySelector('.fu-brief__error-text').textContent)`, 8000), 'error 429: the hourly-limit message');
  mode = 'ok';
  await evaluate(`document.querySelector('[data-brief="retry"]').click(), true`);
  expect(await waitFor(resultShown, 15000), 'error: Try again recovers');
  await typeBrief('  ');
  await submit();
  expect(await waitFor(`!document.querySelector('.fu-brief__error').hidden && /few words/.test(document.querySelector('.fu-brief__error-text').textContent)`, 3000), 'empty brief: asks for a few words, no request');

  // ── Editors without brief templates yet: no box.
  for (const ws of ['newsletter', 'youtube']) {
    const has = await evaluate(`(() => { const core = window.FrameUpBriefCore; return Boolean(core && Object.keys(core.templatesFor(${JSON.stringify(ws)})).length); })()`);
    await evaluate(`location.hash = ${JSON.stringify(ws)}, true`);
    await waitFor(`document.body.dataset.currentPage === ${JSON.stringify(ws)}`, 8000);
    await sleep(500);
    const shown = await evaluate(`Boolean(document.querySelector('.canvas-stack > .fu-brief'))`);
    expect(shown === has, `${ws}: the brief box ${has ? 'shows' : 'stays off until its templates ship'}`);
  }

  const offGrid = [...gridAll];
  console.log(`brief design: ${failures.length} behaviour failure(s), ${uiIssues.length} UI issue(s), ${offGrid.length} off-grid value(s), ${errors.length} console error(s) in ${Math.round((Date.now() - started) / 1000)}s`);
  failures.forEach(f => console.log('FAIL ' + f));
  uiIssues.forEach(f => console.log('UI   ' + f));
  offGrid.forEach(f => console.log('GRID ' + f));
  errors.forEach(f => console.log('ERR  ' + f));
  if (failures.length || uiIssues.length || offGrid.length || errors.length) exitCode = 1;
} catch (error) {
  console.error('brief design: crashed:', error);
  exitCode = 1;
} finally {
  browser.close();
  server.close();
}
process.exit(exitCode);
