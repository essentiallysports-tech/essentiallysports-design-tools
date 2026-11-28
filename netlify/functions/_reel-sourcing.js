'use strict';
// Reels v3 sourcing (server): the right picture for every scene, and the
// review pass that makes a reel "Ready to post" in one go.
//
//   sceneMedia({ plan, esStyle, judgements, exclude }, ctx)
//     Per scene: its subject (the director's, else derived), what the style
//     wants there (clip / photo / none), trusted clip candidates for that
//     subject (video-ads find-clips: the shared library first, live search
//     for at most LIMITS.liveSearches subjects; _clip-trust.js unchanged),
//     verified photos (_asset-service findPhotos -> _photo-verify: only
//     photos verified to show the person / team, with their focus and head
//     boxes) and the pick. A clip is picked only when the vision judge
//     confirmed its subject and moment (reel-clips.js GATE); the browser
//     samples the frames of `judgeQueue` and sends them to clip-judge. No
//     relevant clip -> a verified photo -> an infographic block. Never a
//     random clip, never an unverified photo.
//   review({ plan, picks, corpus }, ctx)
//     Code checks (media relevance, sourced numbers, text on the scale,
//     brand colours and order) plus one cheap model call (Haiku, feature
//     reels-review, capped by maxTokens) that reads the scenes against their
//     pictures and sources. Safe fixes are applied; media problems come back
//     as 'repick'.
//
// Costs (logged in frameup_ai_usage): clip search as video-ads-find-clips
// (cached 30 min per team, library first, $0.06 cap a live search), photo
// verification as reels-photo-verify (vision for at most LIMITS.visionSubjects
// subjects x 6 photos, ~$0.015 each; the rest by caption evidence, $0), the clip judge as
// reels-clip-judge ($0.03 a reel), the review as reels-review (~$0.001).
const C = require('../../reel-clips.js');
const F = require('../../reel-formats.js');
const RULES = require('../../frameup-rules.js');
const gatewayModule = () => require('./_ai-gateway.js');

const PHOTO_FEATURE = 'reels-photo-verify';
const REVIEW_FEATURE = 'reels-review';
const LIMITS = {
  scenes: 32, // v4 reels run 80-100 s in chapters
  subjects: 8, // clip subjects per reel (each walks the ladder)
  photoSubjects: 8, // photo searches per reel (subjects, cards, teams)
  budgetMs: 44000, // the whole scene-media call (reel-maker runs in 60 s)
  liveSearches: 2, // paid live clip searches per reel (the rest: library + free sources)
  broadExtraSearches: 1, // "Find clips" (the person asked): one more live search ($0.06 cap)
  visionSubjects: 3, // photo vision checks per reel (Sonnet, ~$0.0025 a photo; 3 x 4 photos ~ $0.03, the same cap as before; verdicts cached 7 days per photo)
  visionPhotos: 4, // photos per vision check (Generate uses 12; a scene needs one good photo)
  clipsPerScene: 12,
  photosPerSubject: 4,
  searchMs: 40000,
  photoMs: 25000,
  reviewCorpus: 3000,
};
const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
const AWAY_VIA = ['sport', 'colorx', 'color']; // find-clips widening: other teams' clips, never about the subject

const clean = (v, n = 200) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const money = usd => Number((Number(usd) || 0).toFixed(6));
const withTimeout = (promise, ms, fallback) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback).finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
};

// ─── Defaults (tests inject their own) ──────────────────────────────────
function defaultDeps() {
  return {
    findClips: (body, track) => require('./video-ads.js').findClipsFor(body, track),
    findPhotos: (args, ctx) => require('./_asset-service.js').findPhotos(args, ctx),
    verifyWithVision: (subject, photos, opts) => require('./_photo-verify.js').verifyWithVision(subject, photos, opts),
    judgeCache: require('./_reel-clip-judge.js').CACHE,
    confirmed: require('./_reel-clip-confirmed.js'),
    teams: require('../../video-ads-teams.js'),
    gateway: gatewayModule(),
    now: () => Date.now(),
    log: line => console.log(line),
  };
}

// The Gateway with every call logged under the Reels feature (photo-verify
// logs as generate-photo-pick by itself; read-only reuse, no change there).
function trackedGateway(gateway, feature) {
  return { ...gateway, aiText: args => gateway.aiText({ ...args, track: { ...(args && args.track), feature } }) };
}

const CLIP_FIELDS = ['url', 'handle', 'text', 'variants', 'durationMs', 'source', 'sourceKind', 'platform', 'teams', 'players', 'postedAt', 'ageHours', 'shortSide', 'via', 'subjectHit', 'trust', 'quality', 'rung', 'confirmed'];
const slimClip = c => Object.fromEntries(CLIP_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]]));
// Only real photos of the named person / team go on a reel (bug 2026-11-27:
// an ES stat-card graphic "45 PTS / 9 AST / 4 MVP" passed as a verified photo
// of Aaron Rodgers on its title alone). A photo is kept when:
//   - it is not a graphic: the vision check did not flag it, the file is not
//     a PNG / GIF / SVG (ES graphics and templates), and its title, caption
//     and file name carry no graphic / stat-card words;
//   - and the vision check confirmed it, or (no vision for this subject) a
//     photo-agency caption names the subject. A title or file name alone is
//     never enough (graphics are titled with the player's name too).
// -> { ok, reason }
const GRAPHIC_WORDS = /\b(graphics?|infographic|stat ?cards?|stats? (?:card|graphic|line)|template|collage|screenshot|screen shot|poster|wallpaper|logo|thumbnail|illustration|vector|render(?:ing)?|mock-?up|edit|photoshop|quote card|tweet|meme|power rankings?|ranking graphic|split|side[- ]by[- ]side|vs\.? graphic)\b/i;
const STAT_TEXT = /\b\d+(?:\.\d+)?\s*(?:pts|ast|reb|yds|tds?|ints?|mvps?|ppg|rpg|apg|era|hrs?|rbis?)\b/i;
const GRAPHIC_FILE = /\.(?:png|gif|svg|webp)(?:$|[?#])/i;
function reelPhotoOk(p = {}) {
  if (!p || p.verified !== true) return { ok: false, reason: 'photo-unverified' };
  if (p.graphic === true || p.kind === 'graphic') return { ok: false, reason: 'graphic' };
  const file = String(p.sourceUrl || p.url || '');
  let fileName = '';
  try { fileName = decodeURIComponent(new URL(file, 'https://x.invalid').pathname.split('/').pop() || ''); } catch { fileName = file; }
  if (GRAPHIC_FILE.test(fileName)) return { ok: false, reason: 'graphic' };
  const text = `${p.title || ''} ${p.caption || ''} ${fileName.replace(/[-_]+/g, ' ')}`;
  if (GRAPHIC_WORDS.test(text) || STAT_TEXT.test(text)) return { ok: false, reason: 'graphic' };
  if (p.verifiedBy === 'vision') return { ok: true, reason: '' };
  if (p.verifiedBy === 'caption' && String(p.caption || '').trim().length >= 40) return { ok: true, reason: '' };
  return { ok: false, reason: 'photo-unverified' };
}
function photoOut(p) {
  return {
    url: p.url || p.src, sourceUrl: p.sourceUrl, verified: true, verifiedBy: p.verifiedBy || '',
    // What the UI may say: 'vision' = "Checked: shows the right person"; 'caption' = "Matched by its caption".
    checkedBy: p.verifiedBy === 'vision' ? 'vision' : 'caption',
    focus: p.focus || null, head: p.focal || p.head || null, kind: p.kind || '', shot: p.shot || p.detail || '',
    title: clean(p.title, 160), caption: clean(p.caption, 220), credit: clean(p.credit, 120), width: p.width || null, height: p.height || null,
    main: Boolean(p.main), rights: p.rights || null,
  };
}

// The search one subject needs (v3 helper, kept for the old tests / callers).
function searchKey(subject, sport, teams) {
  const teamName = subject.type === 'team' ? subject.name : subject.team;
  const team = teamName && teams && teams.findTeam ? teams.findTeam(teamName, sport) : null;
  return team ? `team:${team.name}` : `q:${C.norm([subject.name, subject.moment].filter(Boolean).join(' ')).slice(0, 80)}`;
}
const subjectHitLocal = (clip, subject) => {
  const name = C.norm(subject.name);
  if (!name) return false;
  return ` ${C.norm([clip.text, ...(clip.players || [])].join(' '))} `.includes(` ${name} `);
};
const isPerson = sub => sub && (sub.type === 'player' || sub.type === 'person');

// One subject's clip candidates: the confirmed library first (free, already
// judged), then the retry ladder (player+moment -> player+game -> team+game
// -> team), one find-clips call per rung, until a rung gives enough.
//   -> { clips, cost, rungs: [{ rung, n, cost, ms, error? }], reason }
// broad (the person pressed "Find clips"): every rung runs (no early stop on
// "enough") and recent rungs look back BROAD_WINDOW_HOURS instead of the
// sport's few days.
const BROAD_WINDOW_HOURS = 21 * 24;
async function clipsForSubject(sub, wants, { deps, sport, track, exclude, claimLive, refundLive, deadlineAt, now, broad = false }) {
  const pool = new Map();
  const tried = [];
  let cost = 0;
  const keep = (c, rung, extra = {}) => {
    if (!c || !c.url || exclude.has(c.url) || pool.has(c.url)) return;
    if (!Array.isArray(c.variants) || !c.variants.length || AWAY_VIA.includes(c.via)) return;
    pool.set(c.url, { ...slimClip(c), subjectHit: subjectHitLocal(c, sub), rung, ...extra });
  };
  // 1. Confirmed library.
  try {
    const keys = deps.confirmed ? deps.confirmed.keysFor(sub, { sport }) : [];
    const rows = keys.length ? await withTimeout(deps.confirmed.read(keys, { kind: wants === 'presser' ? 'presser' : 'clip', token: track && track.token }), 2500, []) : [];
    (rows || []).forEach(r => keep({ ...r.clip, url: r.url }, 'library', { confirmed: { relevance: r.relevance, moment: r.moment, segment: r.segment, rank: r.rank, kind: r.kind, key: r.key } }));
  } catch { /* the library never blocks a search */ }
  const enough = () => {
    const list = [...pool.values()];
    if (list.filter(c => c.confirmed).length >= 2) return true;
    return isPerson(sub) ? list.filter(c => c.subjectHit).length >= 2 : list.length >= 4;
  };
  if (enough() && !broad) return { clips: [...pool.values()], cost, rungs: [{ rung: 'library', n: pool.size }], reason: '' };
  if (!sport) return { clips: [...pool.values()], cost, rungs: tried, reason: pool.size ? '' : 'no-sport' };
  // 2. The ladder.
  for (const step of C.ladderFor(sub, wants, { now: now() })) {
    const left = deadlineAt - now();
    if (left < 4000) { tried.push({ rung: step.rung, n: 0, error: 'deadline' }); break; }
    const live = claimLive();
    const started = now();
    const body = broad && !step.body.windowHours ? { ...step.body, windowHours: BROAD_WINDOW_HOURS } : step.body;
    const res = await withTimeout(deps.findClips({ mode: 'find-clips', sport, subject: { type: isPerson(sub) ? 'player' : (sub.type === 'game' || sub.type === 'moment' ? 'moment' : sub.type), name: sub.name, team: sub.team || '', moment: sub.moment || '' }, ...body },
      { ...(track || {}), freeOnly: !live, deadlineAt: deadlineAt - 1500 }), Math.min(LIMITS.searchMs, left - 1000), null);
    const spent = res && res.ok ? Number(res.cost) || 0 : 0;
    if (live && !spent) refundLive(); // library / cached answer: the live slot is not used up
    cost += spent;
    const before = pool.size;
    if (res && res.ok) (res.clips || []).forEach(c => keep(c, step.rung));
    tried.push({ rung: step.rung, n: pool.size - before, cost: money(spent), ms: now() - started, ...(res ? (res.ok ? {} : { error: clean(res.error || 'failed', 60) }) : { error: 'timeout' }), ...(live ? { live: true } : {}) });
    if (enough() && !broad) break;
  }
  const reason = pool.size ? '' : (tried.some(t => t.error === 'deadline') ? 'deadline' : tried.length && tried.every(t => t.error === 'timeout') ? 'timeout' : 'no-candidates');
  return { clips: [...pool.values()], cost, rungs: tried, reason };
}

// The clip sport of a plan without one: its team, then its words.
function sportOfPlan(plan, beats = []) {
  try {
    const SPORT = require('./_reel-sport.js');
    const teamName = clean(plan.team && plan.team.name, 80);
    if (teamName) {
      const hits = SPORT.teamsNamed(teamName).filter(h => CLIP_SPORTS.includes(h.team.sport));
      if (hits.length && hits.every(h => h.team.sport === hits[0].team.sport)) return hits[0].team.sport;
    }
    const text = [plan.title, plan.script && plan.script.text, ...beats.map(b => [b.vo, b.text, b.media && b.media.subject && b.media.subject.team].filter(Boolean).join(' '))].filter(Boolean).join('\n').slice(0, 8000);
    return SPORT.inferSport(text).sport || '';
  } catch { return ''; }
}

async function sceneMedia(body = {}, ctx = {}) {
  const deps = { ...defaultDeps(), ...(ctx.deps || {}) };
  const now = deps.now || (() => Date.now());
  const started = now();
  const deadlineAt = started + (Number(ctx.budgetMs) || LIMITS.budgetMs);
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
  const allBeats = plan ? C.beatsOf(plan) : [];
  if (!plan || !allBeats.length) return { ok: false, status: 400, error: 'There is no reel to find pictures for yet.' };
  const style = C.styleOf(plan, body.esStyle || body.style || '');
  const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map(u => clean(u, 400)).filter(Boolean));
  const track = ctx.track || null;
  const aiAllowed = ctx.aiAllowed !== false;
  // No clip sport on the plan (a page-built plan, an older reel, a script
  // that names a player but no team): the plan's own words decide it. Before
  // 2026-11-28 such a reel searched nothing and every scene went static.
  const sport = CLIP_SPORTS.includes(plan.sport) ? plan.sport : (clean(plan.sport, 20) ? '' : sportOfPlan(plan, allBeats));
  // "Find clips": one more live search, every rung, a wider window.
  const broad = body.broaden === true || body.ladder === 'broad' || body.findClips === true;
  const capped = { clips: false, photos: false };
  const costs = { clips: 0, photos: 0 };

  const scenes = allBeats.slice(0, LIMITS.scenes).map(b => {
    const subject = C.subjectOfBeat(b, plan);
    const media = b.media && typeof b.media === 'object' ? b.media : {};
    const kind = C.MEDIA_KINDS.includes(media.kind) ? media.kind : '';
    const cards = kind === 'cards' ? (Array.isArray(media.cards) ? media.cards : []).slice(0, 4).map(c => ({ name: clean(c && c.name, 60), ...(c && c.tag ? { tag: clean(c.tag, 30) } : {}), ...(c && c.sticker ? { sticker: clean(c.sticker, 16) } : {}), photos: [] })).filter(c => c.name) : [];
    return {
      beatId: clean(b.id, 40), beat: b, block: b.block ? b.block.type || '' : '', module: b.module ? b.module.type || '' : '', kind, subject, wants: C.wantsFor(b, style),
      durMs: Number(b.durMs) || 0, clips: [], photos: [], teamPhotos: [], cards, noClipReason: '',
    };
  });
  const groupKey = s => `${s.wants === 'presser' ? 'p' : 'c'}|${s.subject.key}`;
  // ── Clips: per subject, confirmed library + the ladder ──
  const clipScenes = scenes.filter(s => s.wants === 'clip' || s.wants === 'presser');
  const groups = [...new Map(clipScenes.map(s => [groupKey(s), { key: groupKey(s), sub: s.subject, wants: s.wants }])).values()];
  if (groups.length > LIMITS.subjects) capped.clips = true;
  let live = 0;
  const liveCap = LIMITS.liveSearches + (broad ? LIMITS.broadExtraSearches : 0);
  const claimLive = () => { if (!aiAllowed) return false; if (live >= liveCap) { capped.clips = true; return false; } live += 1; return true; };
  const refundLive = () => { live = Math.max(0, live - 1); };
  const ladders = {};
  const clipWork = groups.slice(0, LIMITS.subjects).map(async g => {
    const res = await clipsForSubject(g.sub, g.wants, { deps, sport, track, exclude, claimLive, refundLive, deadlineAt, now, broad });
    costs.clips += res.cost;
    ladders[g.key] = res.rungs;
    const rungOrder = r => (r === 'library' ? -1 : C.RUNGS.indexOf(r));
    const ranked = res.clips.sort((a, b) => (Boolean(b.confirmed) - Boolean(a.confirmed)) || (b.subjectHit - a.subjectHit) || (rungOrder(a.rung) - rungOrder(b.rung))).slice(0, LIMITS.clipsPerScene);
    scenes.filter(s => groupKey(s) === g.key).forEach(s => { s.clips = ranked; s.noClipReason = res.reason; });
  });
  scenes.filter(s => (s.wants === 'clip' || s.wants === 'presser') && !groups.slice(0, LIMITS.subjects).some(g => g.key === groupKey(s))).forEach(s => { s.noClipReason = 'subject-cap'; });

  // ── Photos: verified only ──
  // Who needs one, most important first: photo / cutout / cards beats, then
  // beats that would not move without a picture (the motion rule), then the
  // fallback for clip beats, then the teams (the last rung of the photo ladder).
  const photoGateway = deps.gateway && deps.gateway.gatewayConfigured && deps.gateway.gatewayConfigured() ? trackedGateway(deps.gateway, PHOTO_FEATURE) : null;
  const needsMotion = s => s.wants === 'none' && !C.hasAnimatedModule(s.beat) && s.kind !== 'none';
  const wantPhoto = [];
  const addPhoto = (sub, why) => { if (sub && sub.name && !wantPhoto.some(w => w.sub.key === sub.key && w.sub.type === sub.type)) wantPhoto.push({ sub, why }); };
  scenes.filter(s => s.wants === 'photo' && s.kind !== 'cards').forEach(s => addPhoto(s.subject, 'photo'));
  scenes.filter(s => s.kind === 'cards').forEach(s => s.cards.forEach(c => addPhoto(C.subjectOfBeat({ subject: { type: 'player', name: c.name } }, plan), 'card')));
  scenes.filter(needsMotion).forEach(s => addPhoto(s.subject, 'motion'));
  clipScenes.forEach(s => addPhoto(s.subject, 'fallback'));
  const teamNames = [...new Set([plan.team && plan.team.name, ...scenes.map(s => s.subject.team)].map(t => clean(t, 60)).filter(Boolean))].slice(0, 2);
  teamNames.forEach(t => addPhoto({ type: 'team', name: t, team: t, key: C.subjectKey({ name: t }) }, 'team'));
  const photoSubjects = wantPhoto.slice(0, LIMITS.photoSubjects);
  if (wantPhoto.length > LIMITS.photoSubjects) capped.photos = true;
  const names = photoSubjects.filter(w => isPerson(w.sub)).map(w => w.sub.name);
  const photosByKey = new Map();
  const photoDrops = {};
  let visionUsed = 0;
  const photoWork = photoSubjects.map(async ({ sub }) => {
    const vision = aiAllowed && photoGateway && visionUsed < LIMITS.visionSubjects;
    if (vision) visionUsed += 1; else if (aiAllowed && photoGateway) capped.photos = true;
    const args = isPerson(sub)
      ? { person: sub.name, sport: plan.sport || '', teams: sub.team ? [sub.team] : [], others: names.filter(n => n !== sub.name), count: LIMITS.photosPerSubject }
      : sub.type === 'team' ? { team: sub.name, query: sub.name, sport: plan.sport || '', count: LIMITS.photosPerSubject }
        : { query: sub.name, team: sub.team || '', sport: plan.sport || '', count: LIMITS.photosPerSubject };
    const photoCtx = {
      email: track && track.email, token: track && track.token, gated: true,
      deps: { verify: vision ? (subject, photos, opts) => deps.verifyWithVision(subject, photos, { ...opts, max: Math.min(Number(opts && opts.max) || LIMITS.visionPhotos, LIMITS.visionPhotos), gateway: photoGateway }) : null, vision: null },
    };
    const res = await withTimeout(deps.findPhotos(args, photoCtx), Math.max(3000, Math.min(LIMITS.photoMs, deadlineAt - now())), null);
    if (!res || res.ok === false) return;
    costs.photos += Number(res.cost) || 0;
    const kept = [];
    (res.photos || []).forEach(p => {
      if (!p || !(p.url || p.src) || !p.sourceUrl || exclude.has(p.sourceUrl) || exclude.has(p.url)) return;
      const ok = reelPhotoOk(p);
      if (ok.ok) kept.push(photoOut(p)); else photoDrops[ok.reason] = (photoDrops[ok.reason] || 0) + 1;
    });
    photosByKey.set(`${sub.type === 'team' ? 'team' : 'x'}|${sub.key}`, kept);
  });
  await Promise.all([...clipWork, ...photoWork]);
  const photosOf = sub => photosByKey.get(`x|${sub.key}`) || (sub.type === 'team' ? photosByKey.get(`team|${sub.key}`) : null) || [];
  scenes.forEach(s => {
    s.photos = photosOf(s.subject);
    const team = clean(s.subject.team || (plan.team && plan.team.name), 60);
    s.teamPhotos = team ? photosByKey.get(`team|${C.subjectKey({ name: team })}`) || [] : [];
    s.cards.forEach(c => { c.photos = photosByKey.get(`x|${C.subjectKey({ name: c.name })}`) || []; });
  });

  // ── Judgements: what the browser sent (validated) + this server's cache ──
  const judgements = {};
  const sent = body.judgements && typeof body.judgements === 'object' ? body.judgements : {};
  Object.entries(sent).slice(0, 60).forEach(([url, raw]) => { const j = C.validateJudgement(raw); if (j) judgements[clean(url, 400)] = j; });
  const t = now();
  scenes.forEach(s => s.clips.forEach(c => {
    if (judgements[c.url]) return;
    const hit = deps.judgeCache && deps.judgeCache.get(c.url);
    if (hit && t - hit.at < 6 * 3600e3) judgements[c.url] = hit.j;
  }));
  const gw = deps.gateway;
  const judgeAvailable = Boolean(aiAllowed && gw && gw.gatewayConfigured && gw.gatewayConfigured() && !(gw.featureDisabled && gw.featureDisabled('reels-clip-judge')));
  const picks = C.gatedPicks(scenes, { judgements, judgeAvailable });
  const judgedFor = (url, key) => Boolean(judgements[url] && judgements[url].relevance && key in judgements[url].relevance);
  const confirmedUrls = new Set(scenes.flatMap(s => s.clips.filter(c => c.confirmed).map(c => c.url)));
  // A person's clip is judged for their team too (the team gate): a verdict without the team key is judged again.
  const teamKeyOf = new Map(clipScenes.filter(s => isPerson(s.subject) && s.subject.team).map(s => [s.subject.key, C.subjectKey({ name: s.subject.team })]));
  const judgeQueue = judgeAvailable ? C.judgeQueue(clipScenes, { judged: (url, key) => confirmedUrls.has(url) || (judgedFor(url, key) && (!teamKeyOf.has(key) || judgedFor(url, teamKeyOf.get(key)))) }) : [];

  const subjects = [...new Map(scenes.map(s => [`${s.wants === 'presser' ? 'p' : 'c'}|${s.subject.key}`, s])).values()]
    .map(s => ({ key: s.subject.key, label: s.subject.name, type: s.subject.type, ...(s.subject.team ? { team: s.subject.team } : {}), ...(s.subject.date ? { date: s.subject.date } : {}), ...(s.subject.moment ? { moment: s.subject.moment } : {}), wants: s.wants }))
    .filter((s, i, a) => a.findIndex(x => x.key === s.key) === i);
  // The team of every person on a clip scene is judged too, so a game clip of
  // the right team can carry a player's scene when no clip shows the player
  // (the ladder's team rung; before 2026-11-28 the judge rated team clips only
  // against the player, 5-6 of 10, and the gate refused every one).
  clipScenes.forEach(s => {
    const team = clean(s.subject.team, 60);
    if (!isPerson(s.subject) || !team) return;
    const key = C.subjectKey({ name: team });
    if (!subjects.some(x => x.key === key)) subjects.push({ key, label: team, type: 'team', team, wants: s.wants === 'presser' ? 'presser' : 'clip' });
  });
  const picksById = {};
  const beats = scenes.map(s => {
    const p = picks[s.beatId] || { kind: 'none', failures: [] };
    picksById[s.beatId] = p;
    const motion = C.motionFor(s.beat, p);
    const j = url => judgements[url];
    return {
      beatId: s.beatId, ...(s.beat.chapterId ? { chapterId: s.beat.chapterId } : {}), block: s.block, module: s.module, kind: s.kind || s.wants, wants: s.wants, subject: s.subject,
      clips: s.clips.map(c => {
        const jj = j(c.url);
        const rel = jj && jj.relevance && Number.isFinite(jj.relevance[s.subject.key]) ? jj.relevance[s.subject.key] : (c.confirmed ? c.confirmed.relevance : null);
        const mom = jj && jj.moment && Number.isFinite(jj.moment[s.subject.key]) ? jj.moment[s.subject.key] : null;
        const want = s.wants === 'presser' ? 'presser' : 'clip';
        const pass = jj && jj.relevance && s.subject.key in jj.relevance ? C.passesGate(jj, s.subject, C.GATE, want) : (c.confirmed ? true : (!judgeAvailable && C.textGate(c, s.subject, want)));
        const teamKey = isPerson(s.subject) && s.subject.team ? C.subjectKey({ name: s.subject.team }) : '';
        const teamPass = !pass && teamKey && jj && jj.relevance && teamKey in jj.relevance && C.passesGate(jj, { type: 'team', name: s.subject.team, key: teamKey }, C.GATE, want);
        return { ...c, relevance: rel, moment: mom, judged: Boolean(jj), gate: pass ? (jj ? 'judge' : c.confirmed ? 'library' : 'text') : teamPass ? 'team' : '', score: C.judgedScore(c, C.subjectFor({ subject: s.subject }, plan), jj || null).score };
      }),
      photos: s.photos, teamPhotos: s.teamPhotos, ...(s.cards.length ? { cards: s.cards } : {}),
      pick: {
        kind: p.kind,
        ref: (p.kind === 'clip' || p.kind === 'presser') ? p.clip.url : (p.kind === 'photo' || p.kind === 'cutout') ? p.photo.url : '',
        ...(p.segment ? { segment: p.segment } : {}),
        ...((p.kind === 'clip' || p.kind === 'presser') ? { relevance: p.relevance, moment: p.moment, gate: p.gate, ...(p.rung ? { rung: p.rung } : {}) } : {}),
        ...(p.kenBurns ? { kenBurns: p.kenBurns } : {}),
        ...(p.cards ? { cards: p.cards } : {}),
        ...(p.cutout ? { cutout: true } : {}),
        ...(p.kind === 'none' && p.fallback ? { fallback: p.fallback } : {}),
        why: p.why || '',
      },
      motion, motionOk: motion !== 'none', failures: p.failures || [],
      ladder: ladders[groupKey(s)] || [],
    };
  });
  const summary = C.motionSummary({ beats: scenes.map(s => s.beat) }, picksById);
  const stats = C.sourcingStats({ beats: scenes.map(s => s.beat) }, picksById);
  const cost = costs.clips + costs.photos;
  const ms = now() - started;
  if (deps.log) {
    try { deps.log(`reels-sourcing ${JSON.stringify({ style, sport: sport || 'none', planSport: plan.sport || '', broad, beats: stats.beats, clip: stats.clip, photo: stats.photo, module: stats.module, none: stats.none, failures: stats.failures, rungs: stats.rungs, cost: money(cost), ms, liveSearches: live })}`); } catch { /* logging never breaks sourcing */ }
  }
  return {
    ok: true, v: 4, esStyle: style, sport, broad, beats, judgeQueue, subjects, photoDrops,
    clipCount: summary.clipCount, needsClips: summary.needsClips, motionOk: summary.motionOk, actions: summary.actions, stats, ms,
    judge: { ready: judgeAvailable, maxClips: C.JUDGE.maxClips, perCall: C.JUDGE.perCall, maxUsdPerReel: C.JUDGE.maxUsdPerReel, threshold: { relevance: C.GATE.relevance, moment: C.GATE.moment } },
    cost: money(cost), costs: { clips: money(costs.clips), photos: money(costs.photos) }, capped,
  };
}

// ─── Confirmed-clip library: judge results + people's choices ───────────
// Clips that pass the gate for a subject are kept per subject key with their
// best segment (clip-judge mode). Only trusted clips whose files sit on a
// trusted media host are stored; relevance comes from our own judge.
//   clips: the judge request's clips ({ url, handle, text, meta? })
//   subjects: [{ key, label, type, team?, date?, moment?, wants? }]
async function confirmJudged({ clips = [], subjects = [], judgements = {}, sport = '' } = {}, { deps: injected } = {}) {
  const store = (injected && injected.confirmed) || require('./_reel-clip-confirmed.js');
  const TRUST = (injected && injected.trust) || require('./_clip-trust.js');
  const subs = (Array.isArray(subjects) ? subjects : []).slice(0, 12).map(s => ({ key: C.norm(s && s.key).slice(0, 40), name: clean(s && s.label, 60), type: ['player', 'person', 'team', 'game', 'moment'].includes(s && s.type) ? s.type : 'player', team: clean(s && s.team, 60), date: clean(s && s.date, 20), moment: clean(s && s.moment, 60), wants: s && s.wants === 'presser' ? 'presser' : 'clip' })).filter(s => s.key && s.name);
  const entries = [];
  (Array.isArray(clips) ? clips : []).slice(0, C.JUDGE.perCall).forEach(raw => {
    const url = clean(raw && raw.url, 400);
    const j = judgements[url];
    const meta = raw && raw.meta && typeof raw.meta === 'object' ? raw.meta : null;
    if (!j || !meta) return;
    const variants = (Array.isArray(meta.variants) ? meta.variants : []).filter(v => v && TRUST.mediaHostTrusted(String(v.url || '')));
    if (!variants.length) return;
    const platform = clean(meta.platform, 24) || 'x';
    const handle = clean(meta.handle || (raw && raw.handle), 40);
    subs.forEach(sub => {
      if (!C.passesGate(j, sub, C.GATE, sub.wants)) return;
      const trusted = TRUST.isTrusted({ platform, handle, url, mediaUrl: platform === 'x' ? '' : variants[0].url, purpose: sub.wants === 'presser' ? 'presser' : '' });
      if (!trusted) return;
      store.keysFor(sub, { sport }).forEach(key => entries.push({
        key, url, kind: sub.wants, sport, relevance: j.relevance[sub.key], moment: j.moment && Number.isFinite(j.moment[sub.key]) ? j.moment[sub.key] : null, segment: j.segment || null,
        clip: { ...meta, url, handle, platform, variants, text: clean(meta.text || (raw && raw.text), 280) },
      }));
    });
  });
  if (!entries.length) return { written: 0 };
  return store.confirm(entries);
}

// ─── Same-origin clip proxy (the browser's fallback) ────────────────────
// The browser downloads clip files straight from the trusted video CDNs
// (CORS *). When that fails (a CDN without CORS, a 403 to the browser, a
// network policy), it asks this proxy for the file in chunks of at most
// PROXY.chunk bytes (a Vercel response is capped at 4.5 MB; base64 adds a
// third). Allow-listed hosts only: _clip-trust.js MEDIA_HOSTS plus the exact
// hosts in CLIPS_MEDIA_HOSTS, https on 443, every redirect re-checked.
const PROXY = { chunk: 3 * 1024 * 1024, timeoutMs: 15000, maxRedirects: 3 };
function proxyHostAllowed(raw, env = process.env) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const TRUST = require('./_clip-trust.js');
  const extra = String(env.CLIPS_MEDIA_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return TRUST.mediaHostTrusted(u.toString()) || extra.includes(u.hostname.toLowerCase());
}
async function clipProxy(body = {}, { fetchImpl = fetch, env = process.env } = {}) {
  let url = clean(body.url, 800);
  if (!proxyHostAllowed(url, env)) return { ok: false, status: 400, error: 'That file is not on a trusted video host.' };
  const start = Math.max(0, Math.floor(Number(body.start) || 0));
  const end = start + PROXY.chunk - 1;
  let response = null;
  try {
    for (let hop = 0; hop <= PROXY.maxRedirects; hop += 1) {
      response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': 'FrameUp/1.0 (+https://frameup.essentiallysports.com)' }, redirect: 'manual', signal: AbortSignal.timeout(PROXY.timeoutMs) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = response.headers.get('location');
      const target = next ? new URL(next, url).toString() : '';
      if (!target || !proxyHostAllowed(target, env)) return { ok: false, status: 502, reason: 'redirect', error: 'The video host redirected somewhere untrusted.' };
      url = target;
    }
  } catch (error) {
    return { ok: false, status: 504, reason: 'timeout', error: 'The video host did not answer.' };
  }
  if (!response || ![200, 206].includes(response.status)) {
    const status = response ? response.status : 0;
    return { ok: false, status: status === 404 || status === 410 ? 404 : 502, reason: status === 404 || status === 410 ? 'dead' : 'upstream', upstream: status, error: 'The clip file could not be fetched.' };
  }
  const type = response.headers.get('content-type') || 'video/mp4';
  if (!/video|octet-stream|binary|mp4/i.test(type)) return { ok: false, status: 502, reason: 'type', error: 'That is not a video file.' };
  // Read at most one chunk, even when the host ignored the Range header.
  const parts = [];
  let size = 0;
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (reader) {
    while (size < PROXY.chunk) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
      size += value.length;
    }
    try { await reader.cancel(); } catch { /* already closed */ }
  } else {
    const buf = Buffer.from(await response.arrayBuffer());
    parts.push(buf); size = buf.length;
  }
  let bytes = Buffer.concat(parts);
  const range = response.status === 206 ? String(response.headers.get('content-range') || '') : '';
  const m = range.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/);
  let from = m ? Number(m[1]) : 0;
  let total = m && m[3] !== '*' ? Number(m[3]) : Number(response.headers.get('content-length')) || 0;
  if (!m && start > 0) {
    // The host sent the whole file from byte 0: skip to the asked start.
    bytes = bytes.subarray(Math.min(bytes.length, start));
    from = start;
  }
  bytes = bytes.subarray(0, PROXY.chunk);
  if (!bytes.length) return { ok: false, status: 416, reason: 'no-range', error: 'The video host does not serve parts of the file.' };
  if (!total) total = from + bytes.length;
  return { ok: true, bytes, from, to: from + bytes.length - 1, total, type: type.split(';')[0] };
}

// ─── Review ─────────────────────────────────────────────────────────────
// Numbers in the v3 blocks' fields (reel-formats numberFields knows the
// older blocks; these are checked here so a statTile cannot carry an
// unsourced number).
function v3BlockStrings(block) {
  const b = block && typeof block === 'object' ? block : {};
  const arr = v => (Array.isArray(v) ? v : []);
  const out = [];
  if (b.type === 'photoCard') out.push(b.label);
  if (b.type === 'statTiles') arr(b.tiles).forEach(t => out.push(t && t.value, t && t.label, t && t.chip));
  if (b.type === 'dotGrid') { out.push(b.total, b.title); arr(b.groups).forEach(g => out.push(g && g.n, g && g.label)); }
  if (b.type === 'streak') out.push(b.label);
  if (b.type === 'rankTile') out.push(b.kicker, b.rank, b.pos, b.chip);
  if (b.type === 'tagPill' || b.type === 'clipLabel') out.push(b.text);
  return out.filter(v => v != null && v !== '').map(String);
}
function unsourcedIn(beat, sourceSet, format) {
  const bad = new Set(F.unsourcedNumbers(beat, sourceSet, format));
  v3BlockStrings(beat.block).forEach(s => F.numbersIn(s).forEach(n => { if (!sourceSet.has(n)) bad.add(n); }));
  return [...bad];
}
const LINE_MAX = 14; // ES line / pill characters (reel-es LIMITS.lineChars)
const TEXT_WORDS = 9;
const SIGNALS = ['green', 'red'];
const KNOWN_BLOCKS = ['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard', 'photoCard', 'statTiles', 'dotGrid', 'streak', 'rankTile', 'tagPill', 'clipLabel'];

function wrapLines(text, max = LINE_MAX, n = 3) {
  const out = [];
  let line = '';
  String(text || '').split(/\s+/).filter(Boolean).forEach(w => {
    if (!line) line = w; else if (`${line} ${w}`.length <= max) line = `${line} ${w}`; else { out.push(line); line = w; }
  });
  if (line) out.push(line);
  return out.slice(0, n).map(l => l.slice(0, max + 6));
}
const stripNumber = (text, n) => String(text || '').replace(new RegExp(`[$#]?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,/g, ',?')}[%MK]?`, 'g'), '').replace(/\s+/g, ' ').trim();

// Code checks + safe fixes on a copy of the plan. -> { plan, issues }
function codeReview(planIn, { picks = {}, corpus = '', style = '' } = {}) {
  const plan = JSON.parse(JSON.stringify(planIn));
  const issues = [];
  const add = (beatId, kind, severity, problem, fix, fixed) => issues.push({ beatId, kind, severity, problem, fix, fixed: Boolean(fixed) });
  const sourceSet = F.numberSet(corpus);
  const haveCorpus = Boolean(String(corpus || '').trim());
  const beats = plan.beats || [];
  // Order: hook first, end card last.
  const hookAt = beats.findIndex(b => b && b.kind === 'hook');
  if (hookAt > 0) { beats.unshift(beats.splice(hookAt, 1)[0]); add(beats[0].id || 'b1', 'brand', 'warn', 'The hook was not the first scene.', 'reorder', true); }
  const ctaAt = beats.findIndex(b => b && b.kind === 'cta');
  if (ctaAt >= 0 && ctaAt !== beats.length - 1) { beats.push(beats.splice(ctaAt, 1)[0]); add(beats[beats.length - 1].id || '', 'brand', 'warn', 'The end card was not last.', 'reorder', true); }

  beats.forEach((beat, i) => {
    const id = beat.id || `b${i + 1}`;
    const block = beat.block && typeof beat.block === 'object' ? beat.block : null;
    // ── media ──
    const pick = picks[id];
    if (pick && (pick.kind === 'clip' || pick.kind === 'presser')) {
      const judgedOk = pick.gate === 'judge' && Number(pick.relevance) >= C.GATE.relevance && (pick.moment == null || Number(pick.moment) >= C.GATE.moment);
      if (!judgedOk && pick.gate !== 'text') add(id, 'media', 'critical', 'This clip was not confirmed to show the scene\'s subject.', 'repick', false);
    } else if (pick && (pick.kind === 'photo' || pick.kind === 'cutout') && pick.verified !== true) {
      add(id, 'media', 'critical', 'This photo is not verified to show the subject.', 'repick', false);
    }
    // ── blocks we do not know draw as unknown boxes ──
    if (block && !KNOWN_BLOCKS.includes(block.type)) {
      beat.block = C.fallbackBlock({ ...beat, block: null });
      add(id, 'brand', 'critical', `Unknown block "${clean(block.type, 20)}".`, 'statement', true);
    }
    // ── facts ──
    if (haveCorpus) {
      const bad = unsourcedIn(beat, sourceSet, plan.format);
      if (bad.length) {
        const b = beat.block;
        if (b && b.type === 'statTiles') b.tiles = (b.tiles || []).filter(t => !bad.some(n => F.numbersIn(`${t.value} ${t.label} ${t.chip || ''}`).includes(n)));
        if (b && b.type === 'dotGrid' && bad.some(n => F.numbersIn(String(b.total)).includes(n))) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        if (b && b.type === 'rankTile' && bad.some(n => F.numbersIn(`${b.rank} ${b.chip}`).includes(n))) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        if (b && b.type === 'statTiles' && !b.tiles.length) beat.block = C.fallbackBlock({ ...beat, block: null, stat: null });
        bad.forEach(n => { beat.text = stripNumber(beat.text, n); beat.vo = stripNumber(beat.vo, n); });
        if (beat.stat && bad.some(n => F.numbersIn(String(beat.stat.value)).includes(n))) delete beat.stat;
        const still = unsourcedIn(beat, sourceSet, plan.format);
        add(id, 'fact', still.length ? 'critical' : 'warn', `Number${bad.length > 1 ? 's' : ''} not in the sources: ${bad.join(', ')}.`, 'drop-number', !still.length);
      }
    }
    // ── text on the scale ──
    if (F.wordCount(beat.text) > TEXT_WORDS) { beat.text = F.trimWords(beat.text, TEXT_WORDS); add(id, 'text', 'warn', 'On-screen line too long.', 'shorten', true); }
    const b = beat.block;
    if (b && Array.isArray(b.lines) && b.lines.some(l => String(l.text || '').length > LINE_MAX)) {
      const blue = (b.lines.find(l => l.color === 'blue') || {}).text || '';
      const lines = wrapLines(b.lines.map(l => l.text).join(' '));
      b.lines = lines.map((t, k) => ({ text: t, color: blue && blue.includes(t) ? 'blue' : (k === lines.length - 1 && lines.length > 1 && !blue ? 'blue' : 'ink') }));
      add(id, 'text', 'warn', 'A headline line was over 14 characters.', 'shorten', true);
    }
    if (b && Array.isArray(b.pills) && b.pills.some(p => String(p.text || '').length > LINE_MAX)) {
      b.pills = b.pills.map(p => ({ ...p, text: wrapLines(p.text, LINE_MAX, 1)[0] || p.text }));
      add(id, 'text', 'warn', 'A pill was over 14 characters.', 'shorten', true);
    }
    if (b && b.type === 'statTiles' && Array.isArray(b.tiles)) {
      if (b.tiles.length > 3) { b.tiles = b.tiles.slice(0, 3); add(id, 'brand', 'warn', 'More than 3 stat tiles.', 'trim', true); }
      b.tiles.forEach(t => { if (String(t.label || '').length > 18) { t.label = F.trimWords(t.label, 3).slice(0, 18); add(id, 'text', 'warn', 'A tile label was too long.', 'shorten', true); } });
    }
    if (b && (b.type === 'tagPill' || b.type === 'clipLabel') && String(b.text || '').length > 28) { b.text = String(b.text).slice(0, 28).replace(/\s+\S*$/, ''); add(id, 'text', 'warn', 'The pill text was too long.', 'shorten', true); }
    // ── brand colours: never yellow on screen; at most 2 signals ──
    if (b) {
      const colored = [...(b.pills || []), ...(b.lines || []), ...(b.items || []), ...(b.tiles || []), ...(b.type === 'number' ? [b] : [])];
      let yellow = false;
      colored.forEach(x => { ['color', 'tone'].forEach(k => { if (x[k] === 'yellow') { x[k] = 'blue'; yellow = true; } }); });
      if (b.type === 'tagPill' && b.tone === 'yellow') { b.tone = 'red'; yellow = true; }
      if (yellow) add(id, 'brand', 'warn', 'Yellow is for captions only.', 'recolor', true);
      const signals = new Set();
      let over = false;
      colored.forEach(x => ['color', 'tone'].forEach(k => {
        if (!SIGNALS.includes(x[k])) return;
        if (signals.size >= 2 && !signals.has(x[k])) { x[k] = 'ink'; over = true; } else signals.add(x[k]);
      }));
      if (over) add(id, 'brand', 'warn', 'More than two signal colours.', 'recolor', true);
    }
    // ── banned wording ──
    RULES.BANNED.forEach(rule => { if (rule.re.test(`${beat.text} ${beat.vo}`)) add(id, 'text', 'warn', rule.why, 'rewrite', false); });
  });
  // Video-first (Game Tape, and every v4 style): the motion rule wants at
  // least one confirmed clip in the reel (flagged, never blocked here).
  if (style === 'gametape' || C.STYLE_IDS.includes(style)) {
    const media = beats.filter(b => picks[b.id] && picks[b.id].kind !== undefined);
    const clips = media.filter(b => ['clip', 'presser'].includes(picks[b.id].kind)).length;
    if (style === 'gametape' && media.length >= 3 && clips / media.length < 0.5) add('', 'media', 'warn', `Only ${clips} of ${media.length} scenes have a relevant clip; the rest use verified photos or graphics.`, 'none', false);
    else if (media.length >= 2 && !clips) add('', 'media', 'warn', 'No scene has a confirmed clip yet: find clips before export.', 'find-clips', false);
  }
  plan.beats = beats;
  return { plan, issues };
}

const REVIEW_SYSTEM = [
  'You review an EssentiallySports vertical sports reel before it is posted. Each scene has on-screen words, a voiceover line, a block and the picture chosen for it (a clip with what a vision check saw, a verified photo with its caption, or a graphic).',
  'Report only real problems: the picture does not fit the words (wrong player, wrong team, wrong moment); a claim the SOURCES do not support; on-screen words that are vague, too long or do not match the voiceover.',
  'For a words problem you may give a fixed on-screen line ("text", 2-9 words, numbers only from SOURCES) and/or a fixed voiceover ("vo"). Never add a number that is not in SOURCES. For a picture problem give no text, only the problem.',
  'Reply with JSON only: {"issues":[{"beat":"<id>","kind":"media|fact|text","problem":"<= 14 words","text":"optional","vo":"optional"}]}. No problems: {"issues":[]}.',
].join('\n');

function reviewRequest(plan, picks, corpus) {
  const lines = (plan.beats || []).map((b, i) => {
    const id = b.id || `b${i + 1}`;
    const p = picks[id] || {};
    const pic = (p.kind === 'clip' || p.kind === 'presser') ? `${p.kind}: "${clean(p.note || p.text, 120)}"${p.relevance != null ? ` (judge ${p.relevance}/10)` : ''}` : (p.kind === 'photo' || p.kind === 'cutout') ? `photo: "${clean(p.note || p.caption || p.title, 120)}"` : 'graphic only';
    const block = b.block && b.block.type ? b.block.type : b.kind;
    return `- ${id} [${block}] subject: ${clean(b.subject && b.subject.name, 60) || '-'} | text: "${clean(b.text, 90)}" | vo: "${clean(b.vo, 220)}" | picture: ${pic}`;
  });
  return ['SCENES:', ...lines, 'SOURCES:', '<<<', clean(corpus, LIMITS.reviewCorpus) || '(none)', '>>>'].join('\n');
}

async function review(body = {}, ctx = {}) {
  const planIn = body.plan && typeof body.plan === 'object' ? body.plan : null;
  if (!planIn || !Array.isArray(planIn.beats) || !planIn.beats.length) return { ok: false, status: 400, error: 'There is no reel to review yet.' };
  const picksIn = body.picks && typeof body.picks === 'object' ? body.picks : {};
  const picks = {};
  Object.entries(picksIn).slice(0, 40).forEach(([id, p]) => {
    if (!p || typeof p !== 'object') return;
    picks[clean(id, 40)] = {
      kind: ['clip', 'presser', 'photo', 'cutout', 'cards', 'none'].includes(p.kind) ? p.kind : 'none', ref: clean(p.ref, 400),
      relevance: Number.isFinite(Number(p.relevance)) && p.relevance !== null ? Number(p.relevance) : null,
      moment: Number.isFinite(Number(p.moment)) && p.moment !== null ? Number(p.moment) : null,
      gate: ['judge', 'text'].includes(p.gate) ? p.gate : '', verified: p.verified === true, note: clean(p.note, 160),
    };
  });
  const corpus = clean(body.corpus, 12000);
  const style = C.styleOf(planIn, body.esStyle);
  const checked = codeReview(planIn, { picks, corpus, style });
  const plan = checked.plan;
  const issues = checked.issues;
  let cost = 0;
  let model = '';
  const gw = (ctx.deps && ctx.deps.gateway) || gatewayModule();
  if (ctx.aiAllowed !== false && gw && gw.gatewayConfigured && gw.gatewayConfigured()) {
    try {
      const reply = await gw.aiText({
        tier: 'main', system: REVIEW_SYSTEM, cacheSystem: true, json: true,
        messages: [{ role: 'user', content: reviewRequest(plan, picks, corpus) }],
        effort: 'low', maxTokens: 700, timeoutMs: 15000,
        track: ctx.track ? { ...ctx.track, feature: REVIEW_FEATURE } : undefined,
      });
      cost = Number(reply.cost) || 0;
      model = reply.model || '';
      const m = String(reply.text || '').match(/\{[\s\S]*\}/);
      let parsed = null;
      try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
      const sourceSet = F.numberSet(corpus);
      (Array.isArray(parsed && parsed.issues) ? parsed.issues : []).slice(0, 10).forEach(row => {
        const beat = plan.beats.find((b, i) => (b.id || `b${i + 1}`) === clean(row && row.beat, 40));
        if (!beat) return;
        const id = beat.id || `b${plan.beats.indexOf(beat) + 1}`;
        const kind = ['media', 'fact', 'text'].includes(row.kind) ? row.kind : 'text';
        const problem = clean(row.problem, 120) || 'Flagged by the review.';
        if (kind === 'media') { add(id, 'media', 'critical', problem, 'repick', false); return; }
        const next = { ...beat, text: row.text ? F.trimWords(clean(row.text, 90), TEXT_WORDS) : beat.text, vo: row.vo ? F.trimWords(clean(row.vo, 260), 40) : beat.vo };
        const safe = (row.text || row.vo) && !F.unsourcedNumbers({ text: next.text, vo: next.vo }, sourceSet, plan.format).length && !RULES.BANNED.some(r => r.re.test(`${next.text} ${next.vo}`));
        if (safe) {
          beat.text = next.text;
          beat.vo = next.vo;
          if (row.text && beat.block && beat.block.type === 'statement') {
            const lines = wrapLines(next.text.toUpperCase());
            beat.block.lines = lines.map((t, k) => ({ text: t, color: k === lines.length - 1 && lines.length > 1 ? 'blue' : 'ink' }));
          }
        }
        add(id, kind, kind === 'fact' && !safe ? 'critical' : 'warn', problem, 'rewrite', Boolean(safe));
      });
    } catch (error) {
      model = '';
    }
  }
  function add(beatId, kind, severity, problem, fix, fixed) { issues.push({ beatId, kind, severity, problem, fix, fixed: Boolean(fixed) }); }
  const ready = !issues.some(i => i.severity === 'critical' && !i.fixed);
  return { ok: true, ready, issues: issues.slice(0, 40), plan, cost: money(cost), model, esStyle: style };
}

module.exports = { sceneMedia, reelPhotoOk, confirmJudged, clipsForSubject, clipProxy, proxyHostAllowed, PROXY, review, codeReview, reviewRequest, REVIEW_SYSTEM, PHOTO_FEATURE, REVIEW_FEATURE, LIMITS, v3BlockStrings, unsourcedIn, _test: { searchKey, trackedGateway, photoOut, wrapLines, stripNumber } };
