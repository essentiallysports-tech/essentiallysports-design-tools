// Local static server for the explainer recordings: serves the worktree, answers
// every /api/* call from fixtures (no AI, no Supabase, no keys, no network), and
// serves the encoder page and the recorded frames under /__explainer/.
// The stubs reuse the QA harness fixtures (scripts/_qa-generate-fixtures.mjs,
// scripts/fixtures/reels/*) and the server's own code plan for reels.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPlan, qaFile, qaProxyFile } from '../../_qa-generate-fixtures.mjs';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

// ── Generate ────────────────────────────────────────────────────────────────
export const GEN_BRIEF = 'Josh Allen goes over 1,000 rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL';
const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
const GEN_TRENDS = {
  categories: [{ id: 'nfl', label: 'NFL' }, { id: 'nba', label: 'NBA' }, { id: 'golf', label: 'Golf' }],
  items: [
    { title: 'Josh Allen leads the Bills past the Chiefs in a night of firsts', category: 'nfl', image: '/__qa/photo/josh-allen-1.svg', publishedAt: hoursAgo(1) },
    { title: 'Shai Gilgeous-Alexander drops 40 as the Thunder stay perfect at home', category: 'nba', image: '/__qa/photo/shai-gilgeous-alexander-2.svg', publishedAt: hoursAgo(2) },
    { title: 'Scottie Scheffler confirms his schedule for the Hero World Challenge', category: 'golf', image: '/__qa/photo/scottie-scheffler-2.svg', publishedAt: hoursAgo(3) },
    { title: 'Lakers weigh a trade for a third star before the deadline', category: 'nba', publishedAt: hoursAgo(4) },
    { title: 'Arch Manning and Texas prepare for Georgia in a top-five clash', category: 'nfl', publishedAt: hoursAgo(5) },
  ],
};
// The QA figures, drawn as one-colour silhouettes (a neutral stand-in for an ES
// photo: no skin tones or faces, so nothing reads as a cartoon of a real player).
function silhouette(url) {
  const f = qaFile(url);
  if (!f) return null;
  const grad = '<defs><linearGradient id="sil" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#26324A"/><stop offset="1" stop-color="#0B1220"/></linearGradient></defs>';
  let body = f.body.replace(/fill="#(?:C68E62|222|F2F2F2|888|1D428A|C8102E|00338D|552583|006241|E31837|0C2340|BF5700)"/g, 'fill="url(#sil)"');
  body = body.replace(/(<svg[^>]*>)/, `$1${grad}`);
  return { type: f.type, body };
}
const plans = new Map();
async function planFor(want) {
  if (!plans.has(want)) {
    const plan = await buildPlan(GEN_BRIEF, { want });
    // The director's note on the first design, as one free local fix (the QA
    // plan's own note needs an AI rebuild, which this offline demo cannot run).
    const d0 = plan.directions?.[0];
    if (d0?.critique) d0.critique.improvements = [{ id: 'i1', text: 'Give it more drama: deeper contrast and a little grain.', fix: { op: 'fix', name: 'more-drama' }, source: 'check' }];
    plans.set(want, plan);
  }
  return JSON.parse(JSON.stringify(plans.get(want)));
}
async function generateApi(req, url, body, opts) {
  const p = url.pathname;
  if (p === '/api/es-image-search' && url.searchParams.get('image')) { const f = qaProxyFile(url); const m = String(url.searchParams.get('image')).match(/\/qa\/(photo|cutout)\/([a-z0-9-]+-\d)\.jpg$/); const g = m && silhouette(new URL(`http://x/__qa/${m[1]}/${m[2]}.svg`)); return g ? { type: g.type, body: g.body } : f ? { type: f.type, body: f.body } : { status: 404, body: {} }; }
  if (p === '/api/gen-assets') return { body: body?.op === 'cutout' ? { ok: false, reason: 'off', cost: 0 } : body?.op === 'cutout-store' ? { ok: true, url: body.image } : { ok: true } };
  if (p === '/api/trend-design') return { body: GEN_TRENDS };
  if (p === '/api/ai-status') return { body: { ok: true, mode: 'ai', userLimitUsd: 20, userSpentUsd: 3.2, admin: false } };
  if (p === '/api/es-generate' && req.method === 'GET') return { body: { roles: { trending: true } } };
  if (p === '/api/es-generate') {
    const mode = body?.mode || '';
    if (mode === 'creative') return { body: await planFor(Number(body?.want || body?.count || 4) || 4), delay: opts.genDelay ?? 5200 };
    if (mode === 'creative-judge') return { body: { directions: [], cost: 0, source: 'heuristic' } };
    if (mode === 'trending') return { body: { topics: ['Josh Allen MVP race', 'Thunder home streak'] } };
    if (mode === 'photos') return { body: { query: body.query, photos: [{ title: 'Josh Allen', url: '/__qa/photo/josh-allen-1.svg' }] } };
    return { body: { designs: [], runId: 'demo' } };
  }
  return null;
}

// ── Video Ads ───────────────────────────────────────────────────────────────
const VA_PLAYS = [
  { text: 'One-handed grab in the end zone to win it late in the fourth', handle: 'Buckeyes', teams: ['Ohio State Buckeyes'] },
  { text: 'Pick six to seal it and send the crowd home happy', handle: 'ESPNCFB', teams: ['Michigan Wolverines'] },
  { text: '75-yard touchdown run on the first play of the second half', handle: 'BigTenNetwork', teams: ['Ohio State Buckeyes'] },
  { text: 'Fourth-and-goal stop at the one-yard line', handle: 'Georgia Football', teams: ['Georgia Bulldogs'] },
  { text: 'Toe-tap catch on the sideline for a first down', handle: 'Texas Football', teams: ['Texas Longhorns'] },
  { text: 'Walk-off field goal from 52 yards as time expires', handle: 'ESPNCFB', teams: ['Alabama Crimson Tide'] },
];
const vaClip = (i, sport) => {
  const play = VA_PLAYS[i % VA_PLAYS.length];
  return {
    url: `https://x.com/${play.handle.replace(/\s+/g, '')}/status/${18550000 + i}`, handle: play.handle, platform: ['x', 'x', 'bluesky', 'reddit'][i % 4], text: play.text,
    thumb: `https://fixtures.test/thumb-${i % 3}.webp`, duration: 9 + (i % 5), quality: i % 2 ? '720p' : '1080p', sourceKind: ['official', 'league', 'media', 'official'][i % 4],
    postedAt: hoursAgo(1 + i * 2), views: 412000 - i * 31000, likes: 18200 - i * 1300, hasAudio: true, teams: play.teams, sport,
    variants: [{ url: `https://fixtures.test/clip-${i}.webm`, width: 1280, height: 720, bitrate: 2e6 }],
  };
};
const vaClips = (sport, n = 9) => Array.from({ length: n }, (_, i) => vaClip(i, sport));
const VA_COPY = [
  { style: 'highlight', headline: 'Every Buckeyes story, before kickoff. Free.', highlight: 'Free.', body: ['The plays, the depth chart and the news that matters. One email, every morning.'], cta: 'Sign up free', why: 'Leads with the team' },
  { style: 'condensed', headline: 'Your Saturday starts in your inbox', highlight: '', body: ['College football news that respects your time. Free, every day.'], cta: 'Get it free', why: 'Calm and clear' },
  { style: 'simple', headline: 'College football, without the noise', highlight: '', body: ['One short email a day. Free.'], cta: 'Join free', why: 'Short' },
];
function videoAdsApi(body) {
  const m = body?.mode;
  const sport = body?.sport && body.sport !== 'all' ? body.sport : 'cfb';
  switch (m) {
    case 'trends': return { ok: true, items: [{ id: 't1', title: 'Ohio State edges Michigan in a classic', sport: 'cfb', related: [] }, { id: 't2', title: 'Georgia holds on against Texas', sport: 'cfb', related: [] }, { id: 't3', title: 'Alabama wins it at the buzzer', sport: 'cfb', related: [] }] };
    case 'find-clips': return { ok: true, clips: vaClips(sport, 9), teams: [] };
    case 'library': return { ok: true, clips: vaClips(sport, 9), total: 9, teams: [] };
    case 'moments-with-clips': return { ok: true, ranking: 'trending', moments: [
      { id: 'm0', title: 'Buckeyes stun Michigan on a late drive', sport: 'cfb', teams: ['Ohio State Buckeyes'], clips: [vaClip(0, 'cfb'), vaClip(2, 'cfb'), vaClip(4, 'cfb')] },
      { id: 'm1', title: 'Georgia stops Texas at the goal line', sport: 'cfb', teams: ['Georgia Bulldogs'], clips: [vaClip(3, 'cfb'), vaClip(1, 'cfb')] },
      { id: 'm2', title: 'Alabama walks it off from 52 yards', sport: 'cfb', teams: ['Alabama Crimson Tide'], clips: [vaClip(5, 'cfb'), vaClip(6, 'cfb')] },
      { id: 'm3', title: 'Texas toe-tap keeps the drive alive', sport: 'cfb', teams: ['Texas Longhorns'], clips: [vaClip(4, 'cfb'), vaClip(7, 'cfb')] },
      { id: 'm4', title: 'Michigan pick six swings the rivalry', sport: 'cfb', teams: ['Michigan Wolverines'], clips: [vaClip(1, 'cfb'), vaClip(8, 'cfb')] },
      { id: 'm5', title: 'A 75-yard run opens the second half', sport: 'cfb', teams: ['Ohio State Buckeyes'], clips: [vaClip(2, 'cfb'), vaClip(9, 'cfb')] },
    ] };
    case 'clip': return { ok: true, platform: 'x', handle: 'Buckeyes', title: 'Buckeyes on X', quality: '720p', variants: [{ url: 'https://fixtures.test/clip-link.webm', width: 1280, height: 720 }] };
    case 'copy': return body?.set ? { ok: true, variants: [...VA_COPY, { ...VA_COPY[0], style: 'today3', listTitle: 'Today in CFB', items: ['Buckeyes hold on in the Big House', 'The playoff picture shifts', 'The Heisman race tightens'], offer: 'Free, every morning' }] } : { ok: true, variants: VA_COPY };
    case 'grammar': return { ok: true, issues: [] };
    case 'chat': return { ok: true, reply: 'I made the headline shorter and kept that it’s free.', patch: { headline: 'Every Buckeyes story. Free.' } };
    case 'suggest-style': return { ok: true, ranking: [{ style: 'highlight', score: 8.6 }] };
    case 'claims': return { ok: true, canEdit: false, claims: {} };
    default: return { ok: true };
  }
}

// ── Reels Studio ────────────────────────────────────────────────────────────
let reelServer = null;
const fx = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels', name), 'utf8'));
function reelFixtures() {
  const GAME_DATA = fx('game-data-401873063.response.json');
  const base = fx('games-nfl.response.json');
  const d = GAME_DATA.digest;
  const g0 = base.games[0];
  const main = { ...g0, id: d.eventId, name: `${d.teams.away.name} at ${d.teams.home.name}`, teams: { home: { abbr: d.teams.home.abbr, name: d.teams.home.name, score: d.teams.home.score }, away: { abbr: d.teams.away.abbr, name: d.teams.away.name, score: d.teams.away.score } } };
  return { GAME_DATA, GAMES: { ...base, when: 'recent', games: [main, ...base.games.slice(0, 3)] } };
}
let RF = null;
const now = Date.now();
const REEL_TRENDS = {
  ok: true, hours: 48, stale: false, updatedAt: new Date(now).toISOString(),
  items: [
    { id: 't1', sport: 'nfl', title: 'Josh Allen throws for 412 yards and 4 TDs as the Bills beat the Chiefs 31-28', source: 'ESPN', url: 'https://www.espn.com/nfl/', publishedAt: new Date(now - 3600e3).toISOString(), team: 'Buffalo Bills', format: 'stat', related: [{ title: 'Allen’s third 400-yard game this season', url: 'https://www.nfl.com/', source: 'NFL' }] },
    { id: 't2', sport: 'cfb', title: 'Ohio State stays No. 1 after a 38-10 win over Michigan State', source: 'CBS Sports', url: 'https://www.cbssports.com/', publishedAt: new Date(now - 7200e3).toISOString(), team: 'Ohio State Buckeyes', format: 'explainer', related: [] },
    { id: 't3', sport: 'mlb', title: 'Shohei Ohtani wins his fourth MVP award, the first unanimous pick since 2021', source: 'MLB', url: 'https://www.mlb.com/', publishedAt: new Date(now - 10800e3).toISOString(), team: 'Los Angeles Dodgers', format: 'explainer', related: [] },
    { id: 't4', sport: 'golf', title: 'Scottie Scheffler closes with a 64 to win by three at the Tour Championship', source: 'PGA Tour', url: 'https://www.pgatour.com/', publishedAt: new Date(now - 14400e3).toISOString(), team: '', format: 'stat', related: [] },
    { id: 't5', sport: 'nfl', title: 'Cowboys fall 46-40 to the 49ers in a wild shootout at AT&T Stadium', source: 'NFL', url: 'https://www.nfl.com/', publishedAt: new Date(now - 18000e3).toISOString(), team: 'Dallas Cowboys', format: 'explainer', related: [] },
  ],
};
const REEL_CLIP = { url: 'https://x.com/NFL/status/1855000000000000001', handle: 'NFL', text: 'What a catch on third down', thumb: '/__media/broll-thumb-1.webp', postedAt: new Date(now - 3600e3).toISOString(), durationMs: 9000, variants: [{ url: '/__media/broll.mp4', width: 1280, height: 720 }] };
const PHOTOS = ['/__media/broll-thumb-1.webp', '/__media/broll-thumb-0.webp', '/__media/broll-thumb-2.webp'];
async function reelApi(body) {
  if (!reelServer) reelServer = require(path.join(ROOT, 'netlify/functions/reel-maker.js'))._test;
  if (!RF) RF = reelFixtures();
  const mode = body.mode;
  if (mode === 'config') return [200, { ok: true, ai: true, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'Voice is not set up here.' }, music: { ready: false }, formats: [], dataFormats: ['gameswing', 'replay', 'archive'], formatModes: { games: true, 'game-data': true, athlete: true, 'archive-research': true, 'frame-pick': true }, aiClips: { ready: false }, scenes: { ready: false }, clipJudge: { ready: false } }];
  if (mode === 'trends') return [200, REEL_TRENDS];
  if (mode === 'plan') { await sleep(2600); const r = await reelServer.plan(body, { email: 'designer@essentiallysports.com' }, { off: true }); if (r.ok) { r.notice = ''; if (r.source === 'draft') r.source = 'ai'; } return [r.ok ? 200 : (r.status || 502), r]; }
  if (mode === 'games') return [200, body.when === 'live' ? { ...RF.GAMES, when: 'live', games: [] } : RF.GAMES];
  if (mode === 'game-data') return [200, RF.GAME_DATA];
  if (mode === 'athlete') return [200, body.athleteId ? fx('athlete-2330.response.json') : fx('athlete-search.response.json')];
  if (mode === 'archive-research') return [200, fx('archive-research-2330.response.json')];
  if (mode === 'frame-pick') { await sleep(1500); return [200, fx('frame-pick.response.json')]; }
  if (['event', 'project-save', 'projects'].includes(mode)) return [200, { ok: true, cloud: false, projects: [] }];
  return [503, { ok: false, reason: 'off', error: 'AI is not available right now.' }];
}
function reelVideoAdsApi(body) {
  if (body.mode === 'library') return [200, { ok: true, clips: [REEL_CLIP] }];
  if (body.mode === 'clip') return [200, { ok: true, ...REEL_CLIP, url: body.url, thumbnail: REEL_CLIP.thumb }];
  return [200, { ok: true, clips: [] }];
}

// ── Server ──────────────────────────────────────────────────────────────────
// tool: 'generate' | 'video-ads' | 'reels'. extra(url) -> { type, body } | null.
export async function startServer({ tool, extra = null, opts = {}, mounts = {}, uploadDir = '' }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, data, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
    if (url.pathname === '/__blank') { json(200, '<!doctype html><title>FrameUp</title>', 'text/html'); return; }
    const made = extra?.(url) || silhouette(url);
    if (made) { json(200, made.body, made.type); return; }
    if (url.pathname === '/__upload' && req.method === 'POST' && uploadDir) {
      const dir = path.join(uploadDir, path.basename(url.searchParams.get('sub') || '.'));
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(path.join(dir, path.basename(url.searchParams.get('name') || 'upload.bin')));
      req.pipe(out);
      out.on('finish', () => json(200, { ok: true }));
      return;
    }
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (!url.pathname.startsWith(prefix)) continue;
      const file = path.join(dir, path.basename(url.pathname.slice(prefix.length)));
      if (fs.existsSync(file)) { res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res); return; }
      res.writeHead(404); res.end(); return;
    }
    if (url.pathname.startsWith('/__explainer/')) {
      const file = path.join(HERE, url.pathname.replace('/__explainer/', ''));
      if (file.startsWith(HERE) && fs.existsSync(file)) { res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); return; }
    }
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = null;
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (tool === 'generate') {
        const out = (await generateApi(req, url, body, opts)) || { status: 200, body: { ok: true } };
        if (out.delay) await sleep(out.delay);
        json(out.status || 200, out.body, out.type);
        return;
      }
      if (tool === 'video-ads') {
        if (url.pathname === '/api/ai-status') { json(200, { ok: true, mode: 'ai' }); return; }
        if (url.pathname !== '/api/video-ads') { json(200, { ok: true }); return; }
        const delay = { copy: 1600, 'find-clips': 1400, 'moments-with-clips': 1200, library: 900 }[body?.mode] || 300;
        await sleep(delay);
        json(200, videoAdsApi(body));
        return;
      }
      if (tool === 'reels') {
        if (url.pathname === '/api/reel-maker') { const [s, d] = await reelApi(body); json(s, d ?? ''); return; }
        if (url.pathname === '/api/video-ads') { const [s, d] = reelVideoAdsApi(body); json(s, d); return; }
        if (url.pathname === '/api/es-image-search') { json(200, { source: 'es', results: PHOTOS.map((p, i) => ({ id: `p${i}`, proxyUrl: p, title: `ES photo ${i + 1}`, credit: 'ES', width: 1600, height: 900 })) }); return; }
        if (url.pathname === '/api/ai-status') { json(200, { ok: true, mode: 'ai', reason: null }); return; }
        json(200, { ok: true, items: [] });
        return;
      }
      json(200, { ok: true });
      return;
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://localhost:${server.address().port}` };
}

export const FAKE_SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'designer@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'designer@essentiallysports.com',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'ES Designer'}}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); let h = 0x811c9dc5; for (const ch of 'designer@essentiallysports.com') { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } for (const k of ['frameup.tours.v1:u' + h.toString(36), 'frameup.tours.v1:device']) localStorage.setItem(k, JSON.stringify({ welcome: 'never' })); sessionStorage.clear(); sessionStorage.setItem('frameup.tours.offered','1'); sessionStorage.setItem('frameup.tours.versionChecked','1'); return true; })()`;
